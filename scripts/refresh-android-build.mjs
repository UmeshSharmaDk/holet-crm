import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const source = path.join(root, "artifacts/mobile");
const target = path.join(root, "exports/Hotel-CRM-Android");
const backendHost = process.argv[2];
if (backendHost) {
  if (!/^[a-z0-9.-]+$/i.test(backendHost)) {
    throw new Error("Pass the backend hostname without https://, /api, or a trailing slash.");
  }
  const environmentFile = path.join(target, ".env");
  const environment = `# Public backend hostname only. Never put backend secrets here.\nEXPO_PUBLIC_DOMAIN=${backendHost}\n`;
  const previous = await fs.readFile(environmentFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (previous !== environment) {
    await fs.writeFile(environmentFile, environment);
    // Gradle does not track Expo public environment values as JS-bundle inputs.
    // Missing the generated bundle forces :app:createBundleReleaseJsAndAssets.
    await fs.rm(path.join(target, "android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle"),
      { force: true });
  }
}
// Refresh only the generated export, retaining its installed dependencies,
// Gradle caches, and local signing configuration. Never alter the live source.
const gradlePath = path.join(target, "android/app/build.gradle");
const gradle = await fs.readFile(gradlePath, "utf8");
for (const folder of ["app", "assets", "components", "constants", "context", "lib"]) {
  await fs.cp(path.join(source, folder), path.join(target, folder), { recursive: true });
}
const config = JSON.parse(await fs.readFile(path.join(source, "app.json"), "utf8"));
await fs.writeFile(path.join(target, "app.json"), JSON.stringify(config, null, 2) + "\n");
const generated = spawnSync(path.join(target, "node_modules/.bin/expo"),
  ["prebuild", "--platform", "android", "--no-install"], {
    cwd: target, stdio: "inherit",
    env: { ...process.env, CI: "1", EXPO_NO_GIT_STATUS: "1", EXPO_NO_TELEMETRY: "1" },
  });
if (generated.status !== 0) throw new Error(`Android refresh failed (${generated.status}).`);
let updated = gradle
  .replace(/versionCode \d+/, `versionCode ${config.expo.android.versionCode ?? 1}`)
  .replace(/versionName "[^"]+"/, `versionName "${config.expo.version}"`);
if (!updated.includes("internalKeystorePath")) {
  updated = updated.replace("signingConfig signingConfigs.debug\n            }",
    'signingConfig signingConfigs.debug\n                def internalKey = findProperty("internalKeystorePath")\n                if (internalKey) signingConfigs.debug.storeFile = file(internalKey)\n            }');
}
await fs.writeFile(gradlePath, updated);
// Do not allow the generated, publicly shared template key to participate.
await fs.rm(path.join(target, "android/app/debug.keystore"), { force: true });
await fs.copyFile(path.join(root, "scripts/android-studio-guide.md"), path.join(target, "README.md"));
console.info(`Refreshed Android project for ${config.expo.version}, version code ${config.expo.android.versionCode}.`);
