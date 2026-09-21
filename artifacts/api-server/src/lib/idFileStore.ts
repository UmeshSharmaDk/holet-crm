import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const KEY_HEX = process.env["ID_SCAN_ENCRYPTION_KEY"];
if (!KEY_HEX || !/^[0-9a-f]{64}$/i.test(KEY_HEX)) {
  throw new Error(
    "FATAL: ID_SCAN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}
const ENCRYPTION_KEY = Buffer.from(KEY_HEX, "hex");

/**
 * Where guest ID scans live on disk now, encrypted at rest, out of Postgres.
 *
 * Defaults to a temp directory so nothing extra is required to run this
 * locally or in tests. Production MUST override ID_SCAN_STORAGE_DIR to a
 * persistent, backed-up volume — a redeploy or container restart wipes the
 * default, and unlike the database this directory has no existing backup
 * story of its own.
 */
const STORAGE_DIR = process.env["ID_SCAN_STORAGE_DIR"] ?? path.join(os.tmpdir(), "holet-crm-guest-id-scans");

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  dirReady ??= fs.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 }).then(() => undefined);
  return dirReady;
}

export interface StoredIdImage {
  /** Opaque, server-generated — carries no information about the guest, booking, or file name. */
  key: string;
  /** sha256 of the plaintext, for integrity checks that don't require decrypting. */
  checksum: string;
  size: number;
}

/**
 * Encrypts and writes a guest ID image, returning what the row should keep —
 * never the bytes themselves. AES-256-GCM: the auth tag detects tampering or
 * corruption on read, which a bare cipher would not.
 */
export async function storeIdImage(buffer: Buffer): Promise<StoredIdImage> {
  await ensureDir();
  const key = crypto.randomBytes(16).toString("hex");
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  await fs.writeFile(path.join(STORAGE_DIR, key), Buffer.concat([iv, authTag, ciphertext]), { mode: 0o600 });
  return { key, checksum, size: buffer.length };
}

/**
 * Reads and decrypts a guest ID image. Throws (ENOENT) if the key has no
 * file, and throws on decrypt if the auth tag doesn't verify — a caller
 * should treat both as "this scan is not retrievable", not as a 500 for
 * every read on the route.
 */
export async function readIdImage(key: string): Promise<Buffer> {
  const raw = await fs.readFile(path.join(STORAGE_DIR, key));
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Deletes a stored image. Missing is not an error — the retention path may
 * have already removed it. Any other failure is logged, not thrown: cleanup
 * must never fail the request that triggered it (a roster update, a
 * booking delete), or a storage hiccup would block operations that have
 * nothing to do with disk space.
 */
export async function deleteIdImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await fs.unlink(path.join(STORAGE_DIR, key));
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    console.error(`[id-file-store] failed to delete ${key}`, error);
  }
}

export async function deleteIdImages(keys: Array<string | null | undefined>): Promise<void> {
  await Promise.all(keys.map(deleteIdImage));
}
