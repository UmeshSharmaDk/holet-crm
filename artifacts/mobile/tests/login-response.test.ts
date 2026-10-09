import test from "node:test";
import assert from "node:assert/strict";
import { readLoginJson, verifyNativeLoginService, BACKEND_ACCESS_MESSAGE } from "../lib/login-response";

test("a hosting HTML page is not mistaken for a CRM login response", async () => {
  await assert.rejects(
    readLoginJson(new Response("<html>Hosting sign-in</html>", { headers: { "Content-Type": "text/html" } })),
    { message: BACKEND_ACCESS_MESSAGE },
  );
});

test("JSON invalid credentials remain distinguishable from hosting access errors", async () => {
  assert.deepEqual(await readLoginJson(new Response('{"message":"Invalid credentials"}', {
    status: 401, headers: { "Content-Type": "application/json" },
  })), { message: "Invalid credentials" });
});

test("native preflight accepts a reachable API without posting credentials", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ input: unknown; options: RequestInit | undefined }> = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options });
    return new Response('{"error":"Unauthorized"}', { status: 401, headers: { "Content-Type": "application/json" } });
  };
  try {
    await verifyNativeLoginService("https://example.test");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://example.test/api/auth/me");
    assert.equal(calls[0].options?.credentials, "omit");
    assert.equal(calls[0].options?.body, undefined);
  } finally { globalThis.fetch = original; }
});

test("native preflight refuses a private gate before any password can be posted", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>Private</html>", { headers: { "Content-Type": "text/html" } });
  try {
    await assert.rejects(verifyNativeLoginService("https://example.test"), { message: BACKEND_ACCESS_MESSAGE });
  } finally { globalThis.fetch = original; }
});
