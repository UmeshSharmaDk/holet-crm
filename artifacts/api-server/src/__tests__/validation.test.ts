import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

/**
 * Bad input must be refused with a 400, not written to the database or
 * surfaced as a 500. The money cases matter beyond tidiness: `parseFloat` of a
 * missing field yields NaN, which PostgreSQL accepts into a numeric column and
 * which then propagates through every revenue total that sums it.
 */
describe("request validation", () => {
  let f: Fixtures;
  let admin: string, managerB: string;

  before(async () => {
    await startServer();
    f = await seedFixtures();
    admin = await login("admin@test.local");
    managerB = await login("managerb@test.local");
  });

  after(stopServer);

  describe("money", () => {
    for (const [label, receipt] of [
      ["missing", undefined],
      ["non-numeric", "abc"],
      ["negative", -5],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
    ] as const) {
      it(`rejects a ${label} receipt`, async () => {
        const res = await api(`/api/bookings/${f.bookingB}/payment`, {
          token: managerB, method: "PATCH",
          body: receipt === undefined ? {} : { receipt },
        });
        assert.equal(res.status, 400, `got ${res.status}: ${JSON.stringify(res.data)}`);
      });
    }

    it("leaves the stored amount numeric after a rejected write", async () => {
      const res = await api(`/api/bookings/${f.bookingB}`, { token: managerB });
      assert.ok(Number.isFinite(res.data.receipt), `receipt is ${res.data.receipt}`);
      assert.ok(Number.isFinite(res.data.balance), `balance is ${res.data.balance}`);
    });

    it("accepts a valid payment and recomputes the balance", async () => {
      const res = await api(`/api/bookings/${f.bookingB}/payment`, {
        token: managerB, method: "PATCH", body: { receipt: 2500 },
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.receipt, 2500);
      assert.equal(res.data.balance, 4500, "7000 total - 2500 receipt");
    });
  });

  describe("identifiers", () => {
    // The last three are the interesting ones: parseInt truncates rather than
    // failing, so each used to resolve to record 1 instead of being rejected.
    for (const path of [
      "/api/bookings/not-a-number",
      "/api/agencies/abc",
      "/api/hotels/1.5.2",
      "/api/hotels/1abc",
      "/api/bookings/-1",
      "/api/bookings/0",
    ]) {
      it(`rejects ${path} with 400 rather than 500`, async () => {
        const res = await api(path, { token: admin });
        assert.equal(res.status, 400);
      });
    }

    it("rejects a non-numeric user id", async () => {
      assert.equal((await api(`/api/users/xyz`, { token: admin })).status, 400);
    });
  });

  describe("bookings", () => {
    const base = { guestName: "Test", checkIn: "2099-05-01", checkOut: "2099-05-04", roomRent: 100, addOns: 0 };

    it("rejects a checkout before checkin", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST", body: { ...base, checkIn: "2099-05-05", checkOut: "2099-05-01" },
      });
      assert.equal(res.status, 400);
    });

    it("rejects a malformed date", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST", body: { ...base, checkIn: "01-05-2099" },
      });
      assert.equal(res.status, 400);
    });

    it("rejects a negative room rent", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST", body: { ...base, roomRent: -50 },
      });
      assert.equal(res.status, 400);
    });

    it("rejects an unknown status", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST", body: { ...base, status: "refunded" },
      });
      assert.equal(res.status, 400);
    });

    it("rejects a zero room count", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST", body: { ...base, numberOfRooms: 0 },
      });
      assert.equal(res.status, 400);
    });
  });

  describe("error shape", () => {
    it("returns JSON for an unrouted path", async () => {
      const res = await api(`/definitely/not/a/route`);
      assert.equal(res.status, 404);
      assert.equal(res.data.error, "Not Found");
    });

    it("returns JSON for an unrouted api path", async () => {
      const res = await api(`/api/nope`, { token: admin });
      assert.equal(res.status, 404);
      assert.equal(res.data.error, "Not Found");
    });

    it("returns 400 for a login with no credentials", async () => {
      const res = await api(`/api/auth/login`, { method: "POST", body: {} });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, "Bad Request");
    });
  });
});
