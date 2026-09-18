import "./helpers/env.js";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mintCsrfToken } from "../lib/cookies.js";
import {
  api,
  login,
  loginWithCookies,
  parseSetCookies,
  seedFixtures,
  startServer,
  stopServer,
  PASSWORD,
  type Fixtures,
} from "./helpers/index.js";

/**
 * The web build has no Keychain, so a Bearer token there lived in localStorage,
 * where any script on the origin could read it and keep it after the page was
 * closed. The session now travels in an httpOnly cookie that JavaScript cannot
 * reach at all — which means the browser attaches it to cross-site requests
 * too, so every unsafe method has to prove the caller could read the CSRF
 * cookie. These assertions cover both halves: the token really is unreachable,
 * and the cookie really is useless to another origin.
 */
describe("cookie session transport", () => {
  let f: Fixtures;

  before(async () => {
    await startServer();
    f = await seedFixtures();
  });

  after(stopServer);

  describe("login", () => {
    it("withholds the token from the body when cookie transport is requested", async () => {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: { email: "ownera@test.local", password: PASSWORD },
        headers: { "X-Auth-Transport": "cookie" },
      });

      assert.equal(res.status, 200);
      assert.ok(res.data.user, "the profile is still returned");
      // The point of the change: nothing in the response reaches JavaScript.
      assert.equal(res.data.token, undefined);
      assert.ok(
        !JSON.stringify(res.data).includes("eyJ"),
        "no JWT anywhere in the response body",
      );
    });

    it("puts the session in an httpOnly cookie and the CSRF token in a readable one", async () => {
      const { raw } = await loginWithCookies("ownera@test.local");

      const session = raw["holet_session"];
      assert.ok(session, "session cookie is set");
      assert.ok("httponly" in session.attributes, "session cookie is httpOnly");
      assert.equal(session.attributes["samesite"], "Lax");
      assert.equal(session.attributes["path"], "/");
      assert.ok(session.value.startsWith("eyJ"), "session cookie carries the JWT");

      const csrf = raw["holet_csrf"];
      assert.ok(csrf, "CSRF cookie is set");
      assert.ok(
        !("httponly" in csrf.attributes),
        "CSRF cookie must be readable, the client has to echo it back",
      );
    });

    it("still returns a Bearer token and sets no cookie for native clients", async () => {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: { email: "ownera@test.local", password: PASSWORD },
      });

      assert.equal(res.status, 200);
      assert.ok(typeof res.data.token === "string" && res.data.token.length > 0);
      assert.deepEqual(parseSetCookies(res.headers), {});
    });
  });

  describe("authenticating with the cookie", () => {
    it("authenticates a safe request with no header at all", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api("/api/auth/me", { cookies });
      assert.equal(res.status, 200);
      assert.equal(res.data.email, "ownera@test.local");
    });

    it("scopes the cookie session exactly like the Bearer one", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api(`/api/bookings/${f.bookingB}`, { cookies });
      assert.equal(res.status, 404, "hotel B is still invisible to owner A");
    });

    it("prefers an explicit Bearer token over whatever cookie is attached", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");
      const bearer = await login("ownerb@test.local");

      const res = await api("/api/auth/me", { cookies, token: bearer });
      assert.equal(res.status, 200);
      assert.equal(
        res.data.email,
        "ownerb@test.local",
        "the header identifies the caller, not the ambient cookie",
      );
    });
  });

  describe("CSRF protection on cookie sessions", () => {
    it("rejects an unsafe request that sends no CSRF header", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      // Exactly what a cross-site form post looks like: cookies attached by the
      // browser, no header the other origin could have set.
      const res = await api(`/api/bookings/${f.bookingA}`, {
        method: "DELETE",
        cookies,
      });

      assert.equal(res.status, 403);
      assert.match(res.data.message, /CSRF/i);
    });

    it("rejects an unsafe request whose CSRF header does not match the cookie", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api(`/api/bookings/${f.bookingA}`, {
        method: "DELETE",
        cookies,
        headers: { "X-CSRF-Token": mintCsrfToken(2) },
      });

      assert.equal(res.status, 403);
    });

    it("rejects a CSRF token planted for a different user", async () => {
      // Cookie tossing: an attacker who can set cookies on the domain (a
      // sibling subdomain, a plaintext hop) overwrites holet_csrf with a value
      // they know and submit in the header. Plain double-submit accepts that,
      // because header and cookie agree. The signature over the user id does not.
      const { cookies } = await loginWithCookies("ownera@test.local");
      const planted = mintCsrfToken(9999);

      const res = await api(`/api/bookings/${f.bookingA}`, {
        method: "DELETE",
        cookies: { ...cookies, holet_csrf: planted },
        headers: { "X-CSRF-Token": planted },
      });

      assert.equal(res.status, 403);
    });

    it("rejects a forged CSRF token that is not signed at all", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");
      const forged = "not-a-real-nonce.not-a-real-signature";

      const res = await api(`/api/bookings/${f.bookingA}`, {
        method: "DELETE",
        cookies: { ...cookies, holet_csrf: forged },
        headers: { "X-CSRF-Token": forged },
      });

      assert.equal(res.status, 403);
    });

    it("accepts an unsafe request that echoes the CSRF cookie back", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api("/api/agencies", {
        method: "POST",
        cookies,
        headers: { "X-CSRF-Token": cookies["holet_csrf"]! },
        body: {
          name: "CSRF Happy Path Agency",
          contactEmail: "csrf@agency.test",
          contactPhone: "+913333333333",
        },
      });

      assert.equal(res.status, 201, JSON.stringify(res.data));
    });

    it("does not ask a Bearer client for a CSRF token", async () => {
      // Native clients set the Authorization header themselves, so no other
      // site can cause the request. Requiring CSRF there would break them for
      // no gain.
      const token = await login("ownera@test.local");

      const res = await api("/api/agencies", {
        method: "POST",
        token,
        body: {
          name: "Bearer No CSRF Agency",
          contactEmail: "bearer@agency.test",
          contactPhone: "+914444444444",
        },
      });

      assert.equal(res.status, 201, JSON.stringify(res.data));
    });
  });

  describe("logout", () => {
    it("expires both cookies so the session cannot be replayed", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api("/api/auth/logout", {
        method: "POST",
        cookies,
        headers: { "X-CSRF-Token": cookies["holet_csrf"]! },
      });
      assert.equal(res.status, 204);

      const cleared = parseSetCookies(res.headers);
      for (const name of ["holet_session", "holet_csrf"]) {
        const cookie = cleared[name];
        assert.ok(cookie, `${name} is cleared`);
        assert.equal(cookie.value, "", `${name} is emptied`);
        assert.ok(
          new Date(cookie.attributes["expires"] ?? 0).getTime() < Date.now(),
          `${name} is expired in the past`,
        );
      }
    });

    it("refuses a cross-site logout", async () => {
      const { cookies } = await loginWithCookies("ownera@test.local");

      const res = await api("/api/auth/logout", { method: "POST", cookies });

      assert.equal(res.status, 403);
      assert.deepEqual(
        parseSetCookies(res.headers),
        {},
        "a refused logout must not clear anything",
      );
    });

    it("is a no-op for a client that has no cookie", async () => {
      const res = await api("/api/auth/logout", { method: "POST" });
      assert.equal(res.status, 204);
    });
  });
});
