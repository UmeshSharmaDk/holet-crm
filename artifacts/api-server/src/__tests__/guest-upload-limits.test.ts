import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

const MB = 1024 * 1024;

function jpegOfSize(bytes: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(bytes));
  buf.set([0xff, 0xd8, 0xff, 0xe0]);
  return buf;
}

function rosterForm(
  guests: unknown,
  files: { field: string; bytes: Uint8Array<ArrayBuffer>; type?: string }[] = [],
) {
  const form = new FormData();
  form.append("guests", JSON.stringify(guests));
  for (const f of files) {
    form.append(f.field, new Blob([f.bytes], { type: f.type ?? "image/jpeg" }), `${f.field}.jpg`);
  }
  return form;
}

/**
 * Uploads are buffered in memory for the whole request, so the worst case is
 * files x fileSize held at once per concurrent upload. The limits are the only
 * thing bounding that, which makes them worth asserting rather than assuming.
 */
describe("guest upload limits", () => {
  let f: Fixtures;
  let ownerA: string, managerB: string;

  before(async () => {
    await startServer();
    f = await seedFixtures();
    ownerA = await login("ownera@test.local");
    managerB = await login("managerb@test.local");
  });

  after(stopServer);

  it("accepts an ID photo within the size limit", async () => {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: rosterForm(
        [{ personIndex: 1, name: "Alice", relation: "self" }],
        [{ field: "front_0", bytes: jpegOfSize(512 * 1024) }],
      ),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  });

  it("rejects a file over the size limit rather than buffering it", async () => {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: rosterForm(
        [{ personIndex: 1, name: "Alice", relation: "self" }],
        [{ field: "front_0", bytes: jpegOfSize(3 * MB) }],
      ),
    });
    assert.ok(
      res.status === 413 || res.status === 400,
      `a 3 MB upload should be refused, got ${res.status}`,
    );
  });

  it("rejects an oversized roster field", async () => {
    // Padding rather than a long name on purpose: a long name is caught by the
    // name-length validator, so it would pass with or without a field limit and
    // prove nothing. Junk padding keeps every value valid, so only the field
    // size limit can reject this.
    const bloated = [{
      personIndex: 1,
      name: "Alice",
      relation: "self",
      padding: "A".repeat(200 * 1024),
    }];
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST", formData: rosterForm(bloated),
    });
    assert.ok(
      res.status === 413 || res.status === 400,
      `an oversized guests field should be refused, got ${res.status}`,
    );
  });

  it("rejects more files than a full roster could need", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      field: `front_${i}`, bytes: jpegOfSize(1024),
    }));
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: rosterForm([{ personIndex: 1, name: "Alice", relation: "self" }], files),
    });
    assert.ok(
      res.status === 413 || res.status === 400,
      `30 files exceeds front+back for 12 guests, got ${res.status}`,
    );
  });

  it("still refuses a non-image regardless of size", async () => {
    const res = await api(`/api/bookings/${f.bookingA}/guests`, {
      token: ownerA, method: "POST",
      formData: rosterForm(
        [{ personIndex: 1, name: "Alice", relation: "self" }],
        [{ field: "front_0", bytes: jpegOfSize(1024), type: "image/svg+xml" }],
      ),
    });
    const booking = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.ok(
      res.status >= 400 || booking.data.guests?.[0]?.hasFrontId !== true,
      "an SVG was accepted as an identity document",
    );
  });

  it("throttles a caller making repeated upload attempts", async () => {
    // Keyed per user, and counted before the handler runs, so requests that
    // fail scope checks still spend budget.
    let throttled = false;
    for (let i = 0; i < 60; i++) {
      const res = await api(`/api/bookings/${f.bookingA}/guests`, {
        token: managerB, method: "POST",
        formData: rosterForm([{ personIndex: 1, name: "X", relation: "self" }]),
      });
      if (res.status === 429) { throttled = true; break; }
    }
    assert.ok(throttled, "repeated uploads were never throttled");

    // A different account is unaffected.
    const other = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.equal(other.status, 200, "throttling one account affected another");
  });
});
