import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("artifacts/api-server/package.json"));
const sharp = require("sharp");
const source = process.argv[2];
if (!source) throw new Error("Pass the uploaded StayPilot PNG path.");
const directory = path.resolve("artifacts/mobile/assets/images");
// Preserve the original canvas, building, wordmark, and transparent margins.
// Only proportional scaling and padding are permitted; no trimming or crops.
const full = await fs.readFile(source);
await fs.copyFile(source, path.join(directory, "brand-logo.png"));
await fs.copyFile(source, path.join(directory, "brand-mark.png"));

async function canvas(file, image, width, height, edge, background) {
  const resized = await sharp(image).resize({ width, height, fit: "inside" }).png().toBuffer();
  await sharp({ create: { width: edge, height: edge, channels: 4, background } })
    .composite([{ input: resized, gravity: "centre" }]).png().toFile(path.join(directory, file));
}
await canvas("icon.png", full, 1024, 1024, 1024, "#ffffff");
await canvas("adaptive-icon.png", full, 640, 640, 1024, { r: 255, g: 255, b: 255, alpha: 0 });
await canvas("splash-icon.png", full, 1024, 1024, 1024, "#ffffff");
await canvas("favicon.png", full, 512, 512, 512, "#ffffff");
console.info("Prepared supplied logo for login, dashboard, launcher, adaptive icon, splash, and favicon.");
