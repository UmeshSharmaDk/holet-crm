import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// A portable source export only. The live mobile artifact is never prebuilt or
// changed here, and server files, credentials, and booking data are not copied.
const root = process.cwd();
const source = path.join(root, "artifacts/mobile");
const target = path.join(root, "exports/Hotel-CRM-Android");
const host = process.argv[2];
if (!host || !/^[a-z0-9.-]+$/i.test(host)) {
  throw new Error("Pass the verified production backend hostname (without https://).");
}
try {
  await fs.access(target);
  throw new Error("Export directory already exists; use a new destination or remove the prior export explicitly.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.mkdir(target, { recursive: true });
for (const directory of ["app", "assets", "components", "constants", "context", "lib"]) {
  await fs.cp(path.join(source, directory), path.join(target, directory), { recursive: true });
}
for (const file of ["babel.config.js", "metro.config.js", "expo-env.d.ts"]) {
  await fs.copyFile(path.join(source, file), path.join(target, file));
}
const original = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
const dependencies = {};
for (const name of Object.keys({ ...original.dependencies, ...original.devDependencies })) {
  // No workspace imports occur in the mobile source; the generated client is
  // an unused scaffold dependency, not part of this standalone application.
  if (name.startsWith("@workspace/") || ["@expo/cli", "@expo/ngrok"].includes(name)) continue;
  const installed = JSON.parse(await fs.readFile(path.join(source, "node_modules", name, "package.json"), "utf8"));
  dependencies[name] = installed.version;
}
// Babel resolves its configured preset from the standalone project, not from
// Expo's nested node_modules as the original workspace may permit.
const expoRequire = createRequire(path.join(source, "node_modules/expo/package.json"));
dependencies["babel-preset-expo"] = expoRequire("babel-preset-expo/package.json").version;
await fs.writeFile(path.join(target, "package.json"), JSON.stringify({
  name: "hotel-crm-android", version: "1.0.0", private: true, main: "expo-router/entry",
  engines: { node: ">=20.19.4" },
  scripts: {
    typecheck: "tsc --noEmit",
    "bundle:android": "expo export --platform android --output-dir android-bundle-check",
  },
  dependencies,
}, null, 2) + "\n");
const tsconfig = JSON.parse(await fs.readFile(path.join(source, "tsconfig.json"), "utf8"));
delete tsconfig.references;
tsconfig.exclude = ["node_modules", "android", "android-bundle-check"];
await fs.writeFile(path.join(target, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
const app = JSON.parse(await fs.readFile(path.join(source, "app.json"), "utf8"));
app.expo.android = {
  ...app.expo.android,
  package: app.expo.android?.package ?? "com.outhillsmanali.hotelcrm",
  versionCode: app.expo.android?.versionCode ?? 1,
};
// Server addresses are public configuration, never database/API credentials.
await fs.writeFile(path.join(target, ".env"), `# Public backend hostname only. Never put backend secrets here.\nEXPO_PUBLIC_DOMAIN=${host}\n`);
await fs.writeFile(path.join(target, "app.json"), JSON.stringify(app, null, 2) + "\n");
await fs.writeFile(path.join(target, ".gitignore"), [
  "node_modules/", ".expo/", "android-bundle-check/", "android/.gradle/",
  "android/local.properties", "android/build/", "android/app/build/",
  "*.jks", "*.keystore", ".env.local",
].join("\n") + "\n");

// Resolve prebuild against the already-installed SDK without copying its
// node_modules into the downloadable source archive.
await fs.symlink(path.join(source, "node_modules"), path.join(target, "node_modules"), "dir");
const prebuild = spawnSync(path.join(source, "node_modules/.bin/expo"),
  ["prebuild", "--platform", "android", "--no-install"], {
    cwd: target, stdio: "inherit",
    env: { ...process.env, CI: "1", EXPO_NO_GIT_STATUS: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_DOMAIN: host },
  });
if (prebuild.status !== 0) throw new Error(`Android prebuild failed (${prebuild.status}).`);
const finalPackagePath = path.join(target, "package.json");
const finalPackage = JSON.parse(await fs.readFile(finalPackagePath, "utf8"));
delete finalPackage.scripts.android;
delete finalPackage.scripts.ios;
await fs.writeFile(finalPackagePath, JSON.stringify(finalPackage, null, 2) + "\n");
// Never ship a shared template signing key or automatically debug-sign release.
const gradlePath = path.join(target, "android/app/build.gradle");
let gradle = await fs.readFile(gradlePath, "utf8");
gradle = gradle.replace(/    signingConfigs \{\s+debug \{[\s\S]*?\n        \}\n    \}\n/, "");
gradle = gradle.replace(/(release \{[\s\S]*?)\n\s+signingConfig signingConfigs\.debug/,
  "$1\n            // Sign with your private release key through Android Studio.");
await fs.writeFile(gradlePath, gradle);
await fs.rm(path.join(target, "android/app/debug.keystore"), { force: true });
await fs.copyFile(path.join(root, "scripts/android-studio-guide.md"), path.join(target, "README.md"));
await fs.unlink(path.join(target, "node_modules"));
console.info("Next: install standalone dependencies, typecheck, and export an Android bundle before archiving.");
console.info("Generated Android Studio project:", target);
