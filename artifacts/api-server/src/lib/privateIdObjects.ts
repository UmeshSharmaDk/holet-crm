import { Storage } from "@google-cloud/storage";

// Replit's sidecar obtains credentials; application code never handles keys.
const endpoint = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${endpoint}/token`, type: "external_account",
    credential_source: { url: `${endpoint}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateFile(id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Invalid identity object reference.");
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("Private identity storage is not configured.");
  const [bucket, ...parts] = directory.replace(/^\/+/, "").split("/");
  return storage.bucket(bucket).file([...parts, "guest-id-scans", id].join("/"));
}

export async function writePrivateId(id: string, bytes: Buffer) {
  await privateFile(id).save(bytes, {
    resumable: false,
    metadata: { contentType: "application/octet-stream", cacheControl: "private, no-store" },
  });
}
export async function readPrivateId(id: string) {
  const [bytes] = await privateFile(id).download();
  return bytes;
}
export async function deletePrivateId(id: string) {
  await privateFile(id).delete({ ignoreNotFound: true });
}
