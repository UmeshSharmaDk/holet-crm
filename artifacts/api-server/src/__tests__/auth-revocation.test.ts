import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, login, seedFixtures, startServer, stopServer, PASSWORD } from "./helpers/index.js";

/**
 * Authority is re-read from the database on every request, so a change to an
 * account takes effect immediately rather than lingering until the token
 * expires. Previously role and hotel came from the JWT payload, which meant a
 * demoted or deleted account kept full access for the life of its token.
 */
describe("session authority and revocation", () => {
  let admin: string;

  before(async () => {
    await startServer();
    await seedFixtures();
    admin = await login("admin@test.local");
  });

  after(stopServer);

  async function createUser(email: string, role: string, hotelId: number | null, password = "TempPassword123!") {
    const res = await api(`/api/users`, {
      token: admin, method: "POST",
      body: { email, name: "Temp", password, role, ...(hotelId ? { hotelId } : {}) },
    });
    assert.equal(res.status, 201, `setup failed: ${JSON.stringify(res.data)}`);
    return res.data.id as number;
  }

  it("drops admin access the moment the account is demoted", async () => {
    const id = await createUser("demote@test.local", "admin", null);
    const token = await login("demote@test.local", "TempPassword123!");

    assert.equal((await api(`/api/users`, { token })).status, 200, "should work before demotion");

    await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { role: "manager", hotelId: 1 } });

    assert.equal(
      (await api(`/api/users`, { token })).status, 403,
      "the already-issued token still carried admin",
    );
  });

  it("invalidates outstanding tokens when the password changes", async () => {
    const id = await createUser("rotate@test.local", "manager", 1);
    const token = await login("rotate@test.local", "TempPassword123!");

    assert.equal((await api(`/api/auth/me`, { token })).status, 200);

    await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { password: "DifferentPassword456!" } });

    assert.equal(
      (await api(`/api/auth/me`, { token })).status, 401,
      "a token issued before the password change still verified",
    );
  });

  it("revokes access when the account is deleted", async () => {
    const id = await createUser("delete@test.local", "manager", 1);
    const token = await login("delete@test.local", "TempPassword123!");

    await api(`/api/users/${id}`, { token: admin, method: "DELETE" });

    assert.equal((await api(`/api/auth/me`, { token })).status, 401);
  });

  it("applies a hotel reassignment immediately", async () => {
    const id = await createUser("move@test.local", "manager", 1);
    const token = await login("move@test.local", "TempPassword123!");

    const before = await api(`/api/hotels`, { token });
    assert.equal(before.data[0].id, 1);

    await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { hotelId: 2 } });

    const after = await api(`/api/hotels`, { token });
    assert.equal(after.data[0].id, 2, "the old hotel was still visible after reassignment");
  });

  it("refuses to let an admin delete their own account", async () => {
    const me = await api(`/api/auth/me`, { token: admin });
    const res = await api(`/api/users/${me.data.id}`, { token: admin, method: "DELETE" });
    assert.equal(res.status, 400);
  });

  it("will not create a non-admin without a hotel", async () => {
    const res = await api(`/api/users`, {
      token: admin, method: "POST",
      body: { email: "nohotel@test.local", name: "No Hotel", password: "LongEnoughPassword1", role: "manager" },
    });
    assert.equal(res.status, 400, "this shape is the one that used to fail open");
  });

  it("rejects an unknown role", async () => {
    const res = await api(`/api/users`, {
      token: admin, method: "POST",
      body: { email: "evil@test.local", name: "Evil", password: "LongEnoughPassword1", role: "superadmin", hotelId: 1 },
    });
    assert.equal(res.status, 400);
  });

  describe("login", () => {
    it("gives the same answer for an unknown and a wrong-password account", async () => {
      const unknown = await api(`/api/auth/login`, {
        method: "POST", body: { email: "nobody@test.local", password: "whatever" },
      });
      const known = await api(`/api/auth/login`, {
        method: "POST", body: { email: "admin@test.local", password: "wrong-password" },
      });
      assert.equal(unknown.status, 401);
      assert.equal(known.status, 401);
      assert.deepEqual(unknown.data, known.data, "the responses must not distinguish the two");
    });

    it("throttles repeated failures for one account without locking out others", async () => {
      let throttled = false;
      for (let i = 0; i < 30; i++) {
        const res = await api(`/api/auth/login`, {
          method: "POST", body: { email: "ownera@test.local", password: "wrong-password" },
        });
        if (res.status === 429) { throttled = true; break; }
      }
      assert.ok(throttled, "brute force was never throttled");

      // Keyed per account, so a different user is unaffected.
      const other = await api(`/api/auth/login`, {
        method: "POST", body: { email: "managera@test.local", password: PASSWORD },
      });
      assert.equal(other.status, 200, "throttling one account locked out another");
    });
  });
});
