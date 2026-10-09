import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, bookingGuestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";
import { readIdImage } from "../lib/idFileStore.js";

/** Smallest bytes that look like a JPEG; content is never parsed, only stored. */
const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

// Uint8Array | string rather than BlobPart: the DOM lib is not loaded here.
function guestForm(guests: unknown, file?: { name: string; type: string; body: Uint8Array<ArrayBuffer> | string }) {
  const form = new FormData();
  form.append("guests", JSON.stringify(guests));
  if (file) form.append("front_0", new Blob([file.body], { type: file.type }), file.name);
  return form;
}

/**
 * Guest rosters carry photographs of government identity documents — the most
 * sensitive data the platform holds. These cover both who may reach them and
 * how they are served: an upload declaring an executable type and served inline
 * would run as script on the API origin, which is the origin holding the
 * session token.
 */
describe("guest identity documents", () => {
  let f: Fixtures;
  let ownerA: string, managerB: string, orphan: string;

  before(async () => {
    await startServer();
    f = await seedFixtures();
    ownerA = await login("ownera@test.local");
    managerB = await login("managerb@test.local");
    orphan = await login("orphan@test.local");
  });

  after(stopServer);

  async function seedRoster() {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: guestForm(
        [{ personIndex: 1, name: "Alice Confidential", relation: "self" }],
        { name: "my id photo.jpg", type: "image/jpeg", body: JPEG_BYTES },
      ),
    });
    assert.equal(res.status, 201, `roster setup failed: ${JSON.stringify(res.data)}`);
    return res.data.guests[0].id as number;
  }

  it("stores a roster for the owning hotel", async () => {
    const guestId = await seedRoster();
    assert.ok(guestId);

    const booking = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.equal(booking.data.guests.length, 1);
    assert.equal(booking.data.guests[0].hasFrontId, true);
  });

  it("never includes the image bytes in a booking payload", async () => {
    await seedRoster();
    const booking = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    const serialised = JSON.stringify(booking.data);
    assert.ok(!serialised.includes("frontIdData"), "the blob rode along in the booking response");
    assert.ok(!serialised.includes("backIdData"));
  });

  it("refuses a roster write from another hotel", async () => {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: managerB, method: "POST",
      formData: guestForm([{ personIndex: 1, name: "Mallory", relation: "self" }]),
    });
    assert.equal(res.status, 404);
  });

  it("refuses to serve an ID scan to another hotel", async () => {
    const guestId = await seedRoster();
    const res = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: managerB });
    assert.equal(res.status, 404);
  });

  it("refuses to serve an ID scan to an account with no hotel", async () => {
    const guestId = await seedRoster();
    const res = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: orphan });
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
  });

  describe("response headers on a permitted read", () => {
    it("serves an allowlisted content type, nosniff, sanitised filename and no-store", async () => {
      const guestId = await seedRoster();
      const res = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: ownerA });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");

      // The uploaded name was "my id photo.jpg"; only the sanitised form may
      // reach the header, or the filename becomes a header-injection vector.
      const disposition = res.headers.get("content-disposition") ?? "";
      assert.match(
        disposition, /^inline; filename="[A-Za-z0-9._-]+"$/,
        `the stored filename reached the header unsanitised: ${disposition}`,
      );
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] ?? "";
      assert.ok(!filename.includes(" "), `a space survived sanitisation: ${filename}`);
      assert.ok(!filename.includes('"'), "a quote survived sanitisation");

      assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    });
  });

  it("does not store an upload declaring an executable type", async () => {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: guestForm(
        [{ personIndex: 1, name: "Alice", relation: "self" }],
        { name: "payload.svg", type: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' },
      ),
    });

    const booking = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    const stored = booking.data.guests?.[0]?.hasFrontId === true;
    assert.ok(
      res.status >= 400 || !stored,
      "an SVG was accepted as an identity document and can be served back",
    );
  });

  describe("input validation", () => {
    it("rejects a blank guest name", async () => {
      const res = await api(`/api/bookings/${f.bookingA}/guests`, {
        token: ownerA, method: "POST",
        formData: guestForm([{ personIndex: 1, name: "   ", relation: "self" }]),
      });
      assert.equal(res.status, 400);
    });

    it("rejects a roster that does not match the person count", async () => {
      const res = await api(`/api/bookings/${f.bookingA}/guests`, {
        token: ownerA, method: "POST",
        formData: guestForm([
          { personIndex: 1, name: "One", relation: "self" },
          { personIndex: 2, name: "Two", relation: "spouse" },
        ]),
      });
      assert.equal(res.status, 400, "booking A is for one person");
    });

    it("rejects malformed roster JSON with 400 rather than 500", async () => {
      const form = new FormData();
      form.append("guests", "{not json");
      const res = await api(`/api/bookings/${f.bookingA}/guests`, {
        token: ownerA, method: "POST", formData: form,
      });
      assert.equal(res.status, 400);
    });

    it("rejects a non-numeric booking id", async () => {
      const res = await api(`/api/bookings/abc/guests/1/id/front`, { token: ownerA });
      assert.equal(res.status, 400);
    });

    it("rejects an unknown ID side", async () => {
      const res = await api(`/api/bookings/${f.bookingA}/guests/1/id/sideways`, { token: ownerA });
      assert.equal(res.status, 400);
    });
  });

  describe("where the bytes actually live", () => {
    it("stores the scan encrypted on disk, not in the row, and can read it back", async () => {
      const guestId = await seedRoster();
      const [guest] = await db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.id, guestId));
      assert.ok(guest!.frontIdKey, "the row should keep a key, not the bytes");
      assert.ok(guest!.frontIdChecksum);
      assert.equal(guest!.frontIdSize, JPEG_BYTES.length);

      const decrypted = await readIdImage(guest!.frontIdKey!);
      assert.deepEqual(new Uint8Array(decrypted), JPEG_BYTES);

      const res = await api(`/api/bookings/${f.bookingA}/guests/${guestId}/id/front`, { token: ownerA });
      assert.equal(res.status, 200);
    });

    it("deletes the old file when a new upload replaces it", async () => {
      const guestId = await seedRoster();
      const [before] = await db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.id, guestId));
      const oldKey = before!.frontIdKey!;

      const replaced = await api(`/api/bookings/${f.bookingA}/guests`, {
        token: ownerA, method: "POST",
        formData: guestForm(
          [{ personIndex: 1, name: "Alice Confidential", relation: "self" }],
          { name: "new-photo.jpg", type: "image/jpeg", body: new Uint8Array([0xff, 0xd8, 0xff, 0xe1]) },
        ),
      });
      assert.equal(replaced.status, 201);

      await assert.rejects(readIdImage(oldKey), "the superseded scan was still readable from disk");
    });

    it("deletes the file when the booking is deleted", async () => {
      const created = await api(`/api/bookings`, {
        token: ownerA, method: "POST",
        body: { guestName: "Solo Traveller", checkIn: "2099-05-01", checkOut: "2099-05-02", roomRent: 1000, addOns: 0 },
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const bookingId = created.data.id as number;

      const saved = await api(`/api/bookings/${bookingId}/guests`, {
        token: ownerA, method: "POST",
        formData: guestForm(
          [{ personIndex: 1, name: "Solo Traveller", relation: "self" }],
          { name: "id.jpg", type: "image/jpeg", body: JPEG_BYTES },
        ),
      });
      assert.equal(saved.status, 201);
      const [guest] = await db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.bookingId, bookingId));
      const key = guest!.frontIdKey!;

      const deleted = await api(`/api/bookings/${bookingId}`, { token: ownerA, method: "DELETE" });
      assert.equal(deleted.status, 204);

      await assert.rejects(readIdImage(key), "a deleted booking's guest ID scan was still readable from disk");
    });
  });
});
