import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, hotelsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(8));
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);

/**
 * bookings and agencies cascade from hotels, and booking_guests cascades from
 * bookings, so one unguarded request removes a hotel's entire history —
 * including every stored identity document — with no undo short of a database
 * restore.
 */
describe("hotel deletion", () => {
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

  it("refuses a bare delete when the hotel holds records", async () => {
    const res = await api(`/api/hotels/${f.hotelA}`, { token: admin, method: "DELETE" });

    assert.equal(res.status, 409);
    assert.equal(res.data.confirmationRequired, true);

    const [stillThere] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, f.hotelA));
    assert.ok(stillThere, "the hotel was deleted despite the refusal");
  });

  it("reports exactly what would be destroyed", async () => {
    // Give hotel A a guest roster with an ID scan so all three counts are live.
    const form = new FormData();
    form.append("guests", JSON.stringify([{ personIndex: 1, name: "Alice", relation: "self" }]));
    form.append("front_0", new Blob([JPEG], { type: "image/jpeg" }), "id.jpg");
    const saved = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST", formData: form,
    });
    assert.equal(saved.status, 201, "roster setup failed");

    const res = await api(`/api/hotels/${f.hotelA}`, { token: admin, method: "DELETE" });

    assert.equal(res.data.impact.bookings, 1);
    assert.equal(res.data.impact.agencies, 1);
    assert.equal(res.data.impact.guestIdScans, 1, "stored ID scans were not counted");
    assert.match(res.data.message, /cannot be undone/i);
  });

  it("rejects a confirmation that does not match the hotel name", async () => {
    const res = await api(`/api/hotels/${f.hotelA}`, {
      token: admin, method: "DELETE", body: { confirm: "Hotel A " },
    });
    assert.equal(res.status, 409, "a near-miss confirmation was accepted");

    const [stillThere] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, f.hotelA));
    assert.ok(stillThere);
  });

  it("proceeds when the name is confirmed exactly", async () => {
    const res = await api(`/api/hotels/${f.hotelA}`, {
      token: admin, method: "DELETE", body: { confirm: "Hotel A" },
    });
    assert.equal(res.status, 204, JSON.stringify(res.data));

    const [gone] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, f.hotelA));
    assert.equal(gone, undefined);

    // And the cascade did what it always did — the guard is about intent, not
    // about changing what deletion means.
    const orphaned = await db.select().from(bookingsTable).where(eq(bookingsTable.hotelId, f.hotelA));
    assert.equal(orphaned.length, 0);
  });

  it("deletes an empty hotel without ceremony", async () => {
    const created = await api(`/api/hotels`, {
      token: admin, method: "POST", body: { name: "Empty Hotel", totalRooms: 3 },
    });
    assert.equal(created.status, 201);

    const res = await api(`/api/hotels/${created.data.id}`, { token: admin, method: "DELETE" });
    assert.equal(res.status, 204, "an empty hotel should not require confirmation");
  });

  it("is still admin-only", async () => {
    const manager = await login("managera@test.local");
    const res = await api(`/api/hotels/${f.hotelA}`, {
      token: manager, method: "DELETE", body: { confirm: "Hotel A" },
    });
    assert.equal(res.status, 403, "confirmation must not substitute for authorisation");
  });

  it("still 404s for a hotel that does not exist", async () => {
    const res = await api(`/api/hotels/9999`, { token: admin, method: "DELETE" });
    assert.equal(res.status, 404);
  });
});
