import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, passwordResetTokensTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createPasswordResetToken, hashResetToken } from "../lib/passwordReset.js";
import { api, login, seedFixtures, startServer, stopServer, PASSWORD } from "./helpers/index.js";

/**
 * Self-service credential recovery: a "forgot password" email flow and a
 * "change my password" endpoint for an authenticated user. Previously the
 * only way a password changed was an admin calling PUT /users/:id, which
 * meant every reset started as a shared credential.
 */
describe("password reset and change", () => {
  before(async () => {
    await startServer();
  });

  after(stopServer);

  describe("forgot-password", () => {
    it("gives the same response for a known and an unknown email", async () => {
      await seedFixtures();
      const known = await api("/api/auth/forgot-password", {
        method: "POST", body: { email: "managera@test.local" },
      });
      const unknown = await api("/api/auth/forgot-password", {
        method: "POST", body: { email: "nobody@test.local" },
      });
      assert.equal(known.status, 200);
      assert.deepEqual(known.data, unknown.data, "the response must not distinguish the two");
    });

    it("rejects a missing email without touching the database", async () => {
      await seedFixtures();
      const res = await api("/api/auth/forgot-password", { method: "POST", body: {} });
      assert.equal(res.status, 400);
    });

    it("creates exactly one token row for a known account and none for an unknown one", async () => {
      await seedFixtures();
      await api("/api/auth/forgot-password", { method: "POST", body: { email: "managera@test.local" } });
      await api("/api/auth/forgot-password", { method: "POST", body: { email: "nobody@test.local" } });

      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, "managera@test.local"));
      const rows = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user!.id));
      assert.equal(rows.length, 1);

      const total = await db.select().from(passwordResetTokensTable);
      assert.equal(total.length, 1, "an unknown email must not create a row");
    });

    it("invalidates a previous token when a new one is requested", async () => {
      await seedFixtures();
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, "managera@test.local"));
      const firstToken = await createPasswordResetToken(user!.id);

      await api("/api/auth/forgot-password", { method: "POST", body: { email: "managera@test.local" } });

      const res = await api("/api/auth/reset-password", {
        method: "POST", body: { token: firstToken, newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 400, "the superseded token must not still work");
    });

    it("throttles repeated requests for one account without locking out others", async () => {
      await seedFixtures();
      let throttled = false;
      for (let i = 0; i < 10; i++) {
        const res = await api("/api/auth/forgot-password", {
          method: "POST", body: { email: "managera@test.local" },
        });
        if (res.status === 429) { throttled = true; break; }
      }
      assert.ok(throttled, "repeated reset requests were never throttled");

      const other = await api("/api/auth/forgot-password", {
        method: "POST", body: { email: "managerb@test.local" },
      });
      assert.equal(other.status, 200, "throttling one account locked out another");
    });
  });

  describe("reset-password", () => {
    it("changes the password, invalidates outstanding tokens, and consumes the reset token", async () => {
      await seedFixtures();
      const oldToken = await login("managera@test.local");
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, "managera@test.local"));
      const resetToken = await createPasswordResetToken(user!.id);

      const res = await api("/api/auth/reset-password", {
        method: "POST", body: { token: resetToken, newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 200);

      assert.equal(
        (await api("/api/auth/me", { token: oldToken })).status, 401,
        "a session issued before the reset still verified",
      );
      assert.equal(
        (await api("/api/auth/login", { method: "POST", body: { email: "managera@test.local", password: PASSWORD } })).status,
        401,
        "the old password still worked",
      );
      assert.equal(
        (await api("/api/auth/login", { method: "POST", body: { email: "managera@test.local", password: "BrandNewPassword1!" } })).status,
        200,
      );

      const replay = await api("/api/auth/reset-password", {
        method: "POST", body: { token: resetToken, newPassword: "AnotherPassword2!" },
      });
      assert.equal(replay.status, 400, "the same token was accepted twice");
    });

    it("rejects a token that does not exist", async () => {
      await seedFixtures();
      const res = await api("/api/auth/reset-password", {
        method: "POST", body: { token: "not-a-real-token", newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 400);
    });

    it("rejects an expired token without consuming it", async () => {
      await seedFixtures();
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, "managera@test.local"));
      const rawToken = "expired-token-fixture-0123456789";
      await db.insert(passwordResetTokensTable).values({
        userId: user!.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await api("/api/auth/reset-password", {
        method: "POST", body: { token: rawToken, newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 400);

      const [row] = await db
        .select()
        .from(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.tokenHash, hashResetToken(rawToken)));
      assert.ok(row, "an expired token should be left for the sweep, not deleted on lookup");
    });

    it("rejects a new password that is too short, without consuming the token", async () => {
      await seedFixtures();
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, "managera@test.local"));
      const resetToken = await createPasswordResetToken(user!.id);

      const bad = await api("/api/auth/reset-password", {
        method: "POST", body: { token: resetToken, newPassword: "short" },
      });
      assert.equal(bad.status, 400);

      const good = await api("/api/auth/reset-password", {
        method: "POST", body: { token: resetToken, newPassword: "LongEnoughPassword9!" },
      });
      assert.equal(good.status, 200, "a rejected weak password must not have burned the token");
    });
  });

  describe("change-password", () => {
    it("changes the password and returns a token that keeps working", async () => {
      await seedFixtures();
      const oldToken = await login("managera@test.local");

      const res = await api("/api/auth/change-password", {
        token: oldToken, method: "POST",
        body: { currentPassword: PASSWORD, newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 200);
      const newToken = res.data.token as string;
      assert.ok(newToken, "no replacement token was issued");

      assert.equal(
        (await api("/api/auth/me", { token: oldToken })).status, 401,
        "the token used to make this request should not survive it",
      );
      assert.equal((await api("/api/auth/me", { token: newToken })).status, 200);
      assert.equal(
        (await api("/api/auth/login", { method: "POST", body: { email: "managera@test.local", password: "BrandNewPassword1!" } })).status,
        200,
      );
    });

    it("rejects the wrong current password and leaves the password unchanged", async () => {
      await seedFixtures();
      const token = await login("managera@test.local");

      const res = await api("/api/auth/change-password", {
        token, method: "POST",
        body: { currentPassword: "totally-wrong", newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 401);

      assert.equal(
        (await api("/api/auth/login", { method: "POST", body: { email: "managera@test.local", password: PASSWORD } })).status,
        200,
        "the password changed despite the wrong currentPassword",
      );
    });

    it("requires authentication", async () => {
      await seedFixtures();
      const res = await api("/api/auth/change-password", {
        method: "POST", body: { currentPassword: PASSWORD, newPassword: "BrandNewPassword1!" },
      });
      assert.equal(res.status, 401);
    });
  });
});
