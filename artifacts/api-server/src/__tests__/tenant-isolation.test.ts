import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

/**
 * The invariant this file exists to protect: a tenant sees its own hotel and
 * nothing else, and an account with no hotel sees nothing at all.
 *
 * The second half matters most. Scoping used to be applied with a truthiness
 * test, so a non-admin whose hotelId was null skipped the filter entirely and
 * received every hotel's data. Any new endpoint that reaches for
 * `req.user.hotelId` directly instead of the hotel scope reintroduces it — a
 * new /dashboard/forecast did exactly that and was caught only by reading the
 * diff. These tests are what should catch it next time.
 */
describe("tenant isolation", () => {
  let f: Fixtures;
  let admin: string, ownerA: string, managerB: string, ownerB: string, orphan: string;

  before(async () => {
    await startServer();
    f = await seedFixtures();
    [admin, ownerA, managerB, ownerB, orphan] = await Promise.all([
      login("admin@test.local"),
      login("ownera@test.local"),
      login("managerb@test.local"),
      login("ownerb@test.local"),
      login("orphan@test.local"),
    ]);
  });

  after(stopServer);

  describe("bookings", () => {
    it("refuses to read another hotel's booking", async () => {
      const res = await api(`/api/bookings/${f.bookingA}`, { token: managerB });
      assert.equal(res.status, 404, "must be 404, not 403 — 403 confirms the id exists");
    });

    it("serves a booking to its own hotel", async () => {
      const res = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
      assert.equal(res.status, 200);
      assert.equal(res.data.guestName, "Alice Confidential");
    });

    it("refuses to update another hotel's booking", async () => {
      const res = await api(`/api/bookings/${f.bookingA}`, {
        token: managerB, method: "PUT", body: { receipt: 999999, status: "cancelled" },
      });
      assert.equal(res.status, 404);

      const check = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
      assert.equal(check.data.receipt, 1000, "the booking must be untouched");
      assert.equal(check.data.status, "confirmed");
    });

    it("refuses to settle another hotel's payment", async () => {
      const res = await api(`/api/bookings/${f.bookingA}/payment`, {
        token: managerB, method: "PATCH", body: { receipt: 500000 },
      });
      assert.equal(res.status, 404);
    });

    it("refuses to delete another hotel's booking even for an owner", async () => {
      const res = await api(`/api/bookings/${f.bookingB}`, { token: ownerA, method: "DELETE" });
      assert.equal(res.status, 404);

      const check = await api(`/api/bookings/${f.bookingB}`, { token: admin });
      assert.equal(check.status, 200, "the booking must still exist");
    });

    it("never lists another hotel's bookings", async () => {
      const res = await api(`/api/bookings`, { token: managerB });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data));
      assert.ok(
        res.data.every((b: any) => b.hotelId === f.hotelB),
        "a foreign hotelId appeared in the list",
      );
    });

    it("refuses to create a booking against another hotel", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST",
        body: { guestName: "X", checkIn: "2099-04-01", checkOut: "2099-04-02", roomRent: 100, addOns: 0, hotelId: f.hotelA },
      });
      assert.equal(res.status, 403);
    });

    it("refuses to attach another hotel's agency", async () => {
      const res = await api(`/api/bookings`, {
        token: managerB, method: "POST",
        body: { guestName: "X", checkIn: "2099-04-01", checkOut: "2099-04-02", roomRent: 100, addOns: 0, agencyId: f.agencyA },
      });
      assert.equal(res.status, 400);
    });
  });

  describe("agencies", () => {
    it("refuses to read another hotel's agency", async () => {
      const res = await api(`/api/agencies/${f.agencyA}`, { token: managerB });
      assert.equal(res.status, 404);
    });

    it("refuses to update another hotel's agency", async () => {
      const res = await api(`/api/agencies/${f.agencyA}`, {
        token: managerB, method: "PUT", body: { name: "taken over" },
      });
      assert.equal(res.status, 404);
    });

    it("refuses to delete another hotel's agency", async () => {
      const res = await api(`/api/agencies/${f.agencyA}`, { token: ownerB, method: "DELETE" });
      assert.equal(res.status, 404);

      const check = await api(`/api/agencies/${f.agencyA}`, { token: admin });
      assert.equal(check.status, 200, "deleting would also orphan hotel A's booking attribution");
    });

    it("preserves contact details on a partial update", async () => {
      const res = await api(`/api/agencies/${f.agencyA}`, {
        token: admin, method: "PUT", body: { name: "Agency A Renamed" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.contactEmail, "a@agency.test", "an omitted field must not be nulled");
      assert.equal(res.data.contactPhone, "+911111111111");
    });
  });

  describe("hotels", () => {
    it("shows a tenant only its own hotel", async () => {
      const res = await api(`/api/hotels`, { token: managerB });
      assert.equal(res.status, 200);
      assert.equal(res.data.length, 1);
      assert.equal(res.data[0].id, f.hotelB);
    });

    it("refuses to read another hotel's record", async () => {
      const res = await api(`/api/hotels/${f.hotelA}`, { token: managerB });
      assert.equal(res.status, 404);
    });

    it("shows an admin every hotel", async () => {
      const res = await api(`/api/hotels`, { token: admin });
      assert.equal(res.data.length, 2);
    });
  });

  describe("an account with no hotel fails closed", () => {
    // Every list endpoint. A new one added without the hotel scope belongs here
    // and will fail until it is wired up correctly.
    const endpoints = [
      "/api/bookings",
      "/api/agencies",
      "/api/dashboard/stats",
      "/api/dashboard/checkins",
      "/api/dashboard/checkouts",
      "/api/dashboard/forecast",
      "/api/analytics/revenue",
      "/api/analytics/occupancy",
    ];

    for (const path of endpoints) {
      it(`denies ${path} instead of returning every hotel`, async () => {
        const res = await api(path, { token: orphan });
        assert.equal(res.status, 403, `${path} must deny, not widen`);
        assert.ok(
          !Array.isArray(res.data) || res.data.length === 0,
          `${path} returned data to an unscoped account`,
        );
      });
    }

    it("returns no hotels", async () => {
      const res = await api(`/api/hotels`, { token: orphan });
      assert.deepEqual(res.data, []);
    });
  });

  describe("scope cannot be widened by query parameter", () => {
    it("ignores hotelId on a tenant's booking list", async () => {
      const res = await api(`/api/bookings?hotelId=${f.hotelA}`, { token: managerB });
      assert.ok(
        !res.data.some?.((b: any) => b.hotelId === f.hotelA),
        "a tenant forced another hotel through the query string",
      );
    });

    it("ignores hotelId on the forecast", async () => {
      const res = await api(`/api/dashboard/forecast?hotelId=${f.hotelA}`, { token: managerB });
      assert.ok(
        !res.data.some?.((b: any) => b.hotelId === f.hotelA),
        "the forecast honoured a caller-supplied hotelId",
      );
    });
  });

  describe("role requirements", () => {
    it("keeps a manager out of user administration", async () => {
      assert.equal((await api(`/api/users`, { token: managerB })).status, 403);
    });

    it("keeps a manager from creating hotels", async () => {
      const res = await api(`/api/hotels`, { token: managerB, method: "POST", body: { name: "Rogue", totalRooms: 5 } });
      assert.equal(res.status, 403);
    });

    it("rejects an unauthenticated request", async () => {
      assert.equal((await api(`/api/bookings`)).status, 401);
    });

    it("rejects a malformed token", async () => {
      assert.equal((await api(`/api/bookings`, { token: "not.a.token" })).status, 401);
    });
  });
});
