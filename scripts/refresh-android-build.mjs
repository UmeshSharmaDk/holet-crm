import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const source = path.join(root, "artifacts/mobile");
const target = path.join(root, "exports/Hotel-CRM-Android");
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
console.info(`Refreshed Android project for ${config.expo.version}, version code ${config.expo.android.versionCode}.`);
