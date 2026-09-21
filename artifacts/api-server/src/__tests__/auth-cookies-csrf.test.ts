import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, extractCookieValue, login, seedFixtures, startServer, stopServer, PASSWORD } from "./helpers/index.js";

/**
 * The web client no longer holds the token in JS-reachable storage: login
 * sets an httpOnly cookie instead, and a separate readable CSRF cookie the
 * client echoes back as a header. Native is unaffected — it still gets the
 * token in the JSON body and authenticates with a Bearer header, which
 * these cookies have no bearing on.
 */
describe("cookie auth and CSRF", () => {
  before(async () => {
    await startServer();
  });

  async function loginForCookies(email = "managera@test.local") {
    const res = await api("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
    assert.equal(res.status, 200);
    const authToken = extractCookieValue(res, "auth_token");
    const csrfToken = extractCookieValue(res, "csrf_token");
    assert.ok(authToken, "login did not set the auth cookie");
    assert.ok(csrfToken, "login did not set the csrf cookie");
    return { authToken: authToken!, csrfToken: csrfToken!, cookie: `auth_token=${authToken}; csrf_token=${csrfToken}` };
  }

  after(stopServer);

  it("sets an httpOnly-style auth cookie and a readable csrf cookie on login", async () => {
    await seedFixtures();
    const res = await api("/api/auth/login", {
      method: "POST", body: { email: "managera@test.local", password: PASSWORD },
    });
    const setCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const authCookieLine = setCookie.find((c) => c.startsWith("auth_token="));
    const csrfCookieLine = setCookie.find((c) => c.startsWith("csrf_token="));
    assert.ok(authCookieLine?.toLowerCase().includes("httponly"), "auth cookie must be httpOnly");
    assert.ok(!csrfCookieLine?.toLowerCase().includes("httponly"), "csrf cookie must be readable by JS");
  });

  it("authenticates a request from the cookie alone, with no Authorization header", async () => {
    await seedFixtures();
    const { cookie } = await loginForCookies();
    const res = await api("/api/auth/me", { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.email, "managera@test.local");
  });

  it("rejects a garbage cookie the same way as a garbage Bearer token", async () => {
    await seedFixtures();
    const res = await api("/api/auth/me", { cookie: "auth_token=not-a-real-token" });
    assert.equal(res.status, 401);
  });

  it("blocks a cookie-authenticated mutating request with no CSRF header", async () => {
    await seedFixtures();
    const { cookie } = await loginForCookies("admin@test.local");
    const res = await api("/api/users", {
      cookie, method: "POST",
      body: { email: "nocsrf@test.local", name: "No CSRF", password: "LongEnoughPassword1", role: "manager", hotelId: 1 },
    });
    assert.equal(res.status, 403);
  });

  it("blocks a cookie-authenticated mutating request with a mismatched CSRF header", async () => {
    await seedFixtures();
    const { cookie } = await loginForCookies("admin@test.local");
    const res = await api("/api/users", {
      cookie, method: "POST",
      headers: { "X-CSRF-Token": "some-other-value" },
      body: { email: "badcsrf@test.local", name: "Bad CSRF", password: "LongEnoughPassword1", role: "manager", hotelId: 1 },
    });
    assert.equal(res.status, 403);
  });

  it("allows a cookie-authenticated mutating request whose CSRF header matches the cookie", async () => {
    await seedFixtures();
    const { cookie, csrfToken } = await loginForCookies("admin@test.local");
    const res = await api("/api/users", {
      cookie, method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: { email: "goodcsrf@test.local", name: "Good CSRF", password: "LongEnoughPassword1", role: "manager", hotelId: 1 },
    });
    assert.equal(res.status, 201);
  });

  it("never requires a CSRF header for a Bearer-authenticated mutating request", async () => {
    await seedFixtures();
    const adminToken = await login("admin@test.local");
    const res = await api("/api/users", {
      token: adminToken, method: "POST",
      body: { email: "bearer-fine@test.local", name: "Bearer Fine", password: "LongEnoughPassword1", role: "manager", hotelId: 1 },
    });
    assert.equal(res.status, 201, "a Bearer request must never be blocked for lacking a CSRF header");
  });

  it("does not require CSRF for a GET, even when cookie-authenticated", async () => {
    await seedFixtures();
    const { cookie } = await loginForCookies();
    const res = await api("/api/hotels", { cookie });
    assert.equal(res.status, 200);
  });

  it("logs out by clearing both cookies", async () => {
    await seedFixtures();
    const { cookie, csrfToken } = await loginForCookies();
    const res = await api("/api/auth/logout", { cookie, method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    assert.equal(res.status, 204);

    const setCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cleared = setCookie.filter((c) => /^(auth_token|csrf_token)=;/.test(c) || /Max-Age=0/i.test(c) || /Expires=Thu, 01 Jan 1970/i.test(c));
    assert.ok(cleared.length >= 2, `expected both cookies cleared, got: ${JSON.stringify(setCookie)}`);
  });

  it("keeps a change-password cookie session working by re-issuing the auth cookie", async () => {
    await seedFixtures();
    const { cookie, csrfToken } = await loginForCookies("managera@test.local");

    const res = await api("/api/auth/change-password", {
      cookie, method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: { currentPassword: PASSWORD, newPassword: "BrandNewPassword1!" },
    });
    assert.equal(res.status, 200);

    const newAuthToken = extractCookieValue(res, "auth_token");
    assert.ok(newAuthToken, "change-password did not refresh the cookie for a cookie session");

    const staleCheck = await api("/api/auth/me", { cookie });
    assert.equal(staleCheck.status, 401, "the pre-change cookie should be invalidated");

    const freshCheck = await api("/api/auth/me", { cookie: `auth_token=${newAuthToken}` });
    assert.equal(freshCheck.status, 200, "the refreshed cookie should still work");
  });
});
