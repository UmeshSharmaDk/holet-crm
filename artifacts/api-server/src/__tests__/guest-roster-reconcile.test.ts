import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, bookingGuestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";
import { readIdImage } from "../lib/idFileStore.js";

const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(8));
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);

function roster(count: number, withIds = false) {
  const form = new FormData();
  form.append(
    "guests",
    JSON.stringify(
      Array.from({ length: count }, (_, i) => ({
        personIndex: i + 1,
        name: `Guest ${i + 1}`,
        relation: i === 0 ? "self" : "family",
      })),
    ),
  );
  if (withIds) {
    for (let i = 0; i < count; i++) {
      form.append(`front_${i}`, new Blob([JPEG], { type: "image/jpeg" }), `id${i}.jpg`);
    }
  }
  return form;
}

/**
 * Saving a roster requires guests.length === booking.numberOfPersons, but the
 * count could be lowered through PUT /bookings/:id without touching
 * booking_guests. Rows for people no longer on the booking stayed, and with
 * them their identity documents — retained indefinitely for guests the booking
 * no longer records.
 */
describe("guest roster follows the party size", () => {
  let f: Fixtures;
  let ownerA: string;

  before(async () => {
    await startServer();
  });

  after(stopServer);

  beforeEach(async () => {
    f = await seedFixtures();
    ownerA = await login("ownera@test.local");
    // Booking A is seeded for one person; widen it so there is a roster to trim.
    await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 4 },
    });
    const saved = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST", formData: roster(4, true),
    });
    assert.equal(saved.status, 201, `roster setup failed: ${JSON.stringify(saved.data)}`);
  });

  async function storedGuests() {
    return db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.bookingId, f.bookingA));
  }

  it("removes surplus guests when the party shrinks", async () => {
    assert.equal((await storedGuests()).length, 4, "precondition");

    const res = await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 2 },
    });
    assert.equal(res.status, 200);

    const remaining = await storedGuests();
    assert.equal(remaining.length, 2, "surplus guest rows were left behind");
    assert.deepEqual(
      remaining.map((g) => g.personIndex).sort(),
      [0, 1],
      "the wrong rows were kept",
    );
  });

  it("destroys the ID scans held for removed guests", async () => {
    const before = await storedGuests();
    assert.ok(before.every((g) => g.frontIdKey), "precondition: every guest has a scan");
    const removedKeys = before.filter((g) => g.personIndex >= 1).map((g) => g.frontIdKey!);
    assert.equal(removedKeys.length, 3, "precondition: three guests should be removed");

    await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 1 },
    });

    const remaining = await storedGuests();
    assert.equal(remaining.length, 1);
    // The point of the trim: no identity document survives for someone the
    // booking no longer records — checked against the file store itself,
    // not just the row, since the bytes no longer live in that row at all.
    assert.equal(remaining[0]!.personIndex, 0);
    for (const key of removedKeys) {
      await assert.rejects(
        readIdImage(key),
        `a removed guest's ID scan (key ${key}) was still readable from disk`,
      );
    }
  });

  it("leaves the roster alone when the party grows", async () => {
    const res = await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 6 },
    });
    assert.equal(res.status, 200);
    assert.equal((await storedGuests()).length, 4, "growing must not discard existing guests");
  });

  it("leaves the roster alone when the count is unchanged", async () => {
    await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { guestName: "Renamed Only" },
    });
    assert.equal((await storedGuests()).length, 4);
  });

  it("leaves the booking and its roster agreeing afterwards", async () => {
    await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 3 },
    });

    const booking = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.equal(booking.data.numberOfPersons, 3);
    assert.equal(booking.data.guests.length, 3, "the API reported a roster disagreeing with the booking");

    // And the roster is saveable again at the new size, which it would not be
    // if stale rows remained.
    const resave = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST", formData: roster(3),
    });
    assert.equal(resave.status, 201, JSON.stringify(resave.data));
  });

  it("does not trim when the update is rejected", async () => {
    // An invalid update must not take the roster with it — the delete and the
    // update share a transaction.
    const res = await api(`/api/bookings/${f.bookingA}`, {
      token: ownerA, method: "PUT", body: { numberOfPersons: 1, checkOut: "not-a-date" },
    });
    assert.equal(res.status, 400);
    assert.equal((await storedGuests()).length, 4, "a rejected update still trimmed the roster");
  });
});
