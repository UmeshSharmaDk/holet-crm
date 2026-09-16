import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(8));
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);

/**
 * Access control answers who may act. This answers who did — the question that
 * only matters after something has gone wrong, which is exactly when it is too
 * late to start recording.
 */
describe("audit trail", () => {
  let f: Fixtures;
  let admin: string, ownerA: string;

  before(async () => {
    await startServer();
  });

  after(stopServer);

  beforeEach(async () => {
    f = await seedFixtures();
    admin = await login("admin@test.local");
    ownerA = await login("ownera@test.local");
  });

  const entries = async (action?: string) => {
    const rows = await db.select().from(auditLogTable);
    return action ? rows.filter((r) => r.action === action) : rows;
  };

  async function seedRoster() {
    const form = new FormData();
    form.append("guests", JSON.stringify([{ personIndex: 1, name: "Alice", relation: "self" }]));
    form.append("front_0", new Blob([JPEG], { type: "image/jpeg" }), "id.jpg");
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST", formData: form,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data.guests[0].id as number;
  }

  it("records who read a guest identity document", async () => {
    const guestId = await seedRoster();
    const read = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: ownerA });
    assert.equal(read.status, 200);

    const [entry] = await entries("guest_id_scan.read");
    assert.ok(entry, "reading an ID scan left no trace");
    assert.equal(entry.actorEmail, "ownera@test.local");
    assert.equal(entry.actorRole, "owner");
    assert.equal(entry.targetId, guestId);
    assert.equal(entry.hotelId, f.hotelA);
    assert.deepEqual(entry.detail, { bookingId: f.bookingA, side: "front" });
  });

  it("never stores the document itself", async () => {
    const guestId = await seedRoster();
    await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: ownerA });

    const serialised = JSON.stringify(await entries());
    assert.ok(!serialised.includes("frontIdData"), "the audit row referenced document bytes");
    assert.ok(!/[A-Za-z0-9+/]{200,}={0,2}/.test(serialised), "something base64-shaped is in the audit trail");
  });

  it("does not record a refused read", async () => {
    const guestId = await seedRoster();
    const managerB = await login("managerb@test.local");
    const res = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: managerB });
    assert.equal(res.status, 404);

    assert.equal((await entries("guest_id_scan.read")).length, 0, "a blocked attempt was logged as a read");
  });

  it("records roster writes with counts rather than contents", async () => {
    await seedRoster();
    const [entry] = await entries("guest_roster.write");
    assert.ok(entry);
    assert.equal(entry.targetId, f.bookingA);
    assert.deepEqual(entry.detail, { guests: 1, withFrontId: 1 });
  });

  describe("destructive actions", () => {
    it("records a booking deletion", async () => {
      await api(`/api/bookings/${f.bookingA}`, { token: ownerA, method: "DELETE" });
      const [entry] = await entries("booking.delete");
      assert.ok(entry);
      assert.equal(entry.targetId, f.bookingA);
      assert.equal(entry.actorEmail, "ownera@test.local");
    });

    it("records an agency deletion", async () => {
      await api(`/api/agencies/${f.agencyA}`, { token: ownerA, method: "DELETE" });
      const [entry] = await entries("agency.delete");
      assert.ok(entry);
      assert.equal(entry.targetId, f.agencyA);
    });

    it("records a hotel deletion with what it destroyed", async () => {
      await api(`/api/hotels/${f.hotelA}`, {
        token: admin, method: "DELETE", body: { confirm: "Hotel A" },
      });
      const [entry] = await entries("hotel.delete");
      assert.ok(entry);
      assert.equal((entry.detail as any).name, "Hotel A");
      assert.equal(typeof (entry.detail as any).bookings, "number");
      assert.equal(typeof (entry.detail as any).guestIdScans, "number");
    });

    it("does not record a refused deletion", async () => {
      const res = await api(`/api/hotels/${f.hotelA}`, { token: admin, method: "DELETE" });
      assert.equal(res.status, 409);
      assert.equal((await entries("hotel.delete")).length, 0, "a refused delete was logged as done");
    });
  });

  describe("account changes", () => {
    async function makeUser(email: string) {
      const res = await api(`/api/users`, {
        token: admin, method: "POST",
        body: { email, name: "Temp", password: "TempPassword123!", role: "manager", hotelId: f.hotelA },
      });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      return res.data.id as number;
    }

    it("records a role change with both values", async () => {
      const id = await makeUser("rolechange@test.local");
      await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { role: "owner" } });

      const [entry] = await entries("user.role_change");
      assert.ok(entry, "a privilege change left no trace");
      assert.equal((entry.detail as any).from, "manager");
      assert.equal((entry.detail as any).to, "owner");
      assert.equal(entry.actorEmail, "admin@test.local");
    });

    it("records a password reset without the password", async () => {
      const id = await makeUser("pwchange@test.local");
      await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { password: "BrandNewPassword456!" } });

      const [entry] = await entries("user.password_change");
      assert.ok(entry);
      const serialised = JSON.stringify(entry);
      assert.ok(!serialised.includes("BrandNewPassword456"), "the new password is in the audit trail");
      assert.ok(!serialised.includes("$2"), "a bcrypt hash is in the audit trail");
    });

    it("does not record a role change that changes nothing", async () => {
      const id = await makeUser("samerole@test.local");
      await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { role: "manager" } });
      assert.equal((await entries("user.role_change")).length, 0, "a no-op was recorded as a change");
    });

    it("keeps the record after the account it describes is deleted", async () => {
      const id = await makeUser("vanishing@test.local");
      await api(`/api/users/${id}`, { token: admin, method: "PUT", body: { role: "owner" } });
      await api(`/api/users/${id}`, { token: admin, method: "DELETE" });

      // The point of having no foreign keys: deleting the subject must not
      // destroy the evidence.
      const rows = await db.select().from(auditLogTable).where(eq(auditLogTable.targetId, id));
      assert.ok(rows.length >= 2, "audit rows vanished with the user they described");
      assert.ok(
        rows.some((r) => r.action === "user.role_change"),
        "the role change record was lost when the account was removed",
      );
      assert.ok(rows.every((r) => r.actorEmail === "admin@test.local"));
    });
  });
});
