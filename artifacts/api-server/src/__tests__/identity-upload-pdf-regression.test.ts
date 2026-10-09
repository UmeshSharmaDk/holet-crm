import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { pool } from "@workspace/db";
import { signToken } from "../lib/jwt.js";
import { deleteIdImages } from "../lib/idFileStore.js";

test("uploaded identity scans are retained and included in a one-page PDF", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Run against the development workflow");
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
  const marker = crypto.randomUUID().toLowerCase();
  let hotelId: number | undefined, userId: number | undefined, bookingId: number | undefined;
  const directory = await mkdtemp(path.join(os.tmpdir(), "identity-pdf-check-"));
  try {
    hotelId = (await pool.query("INSERT INTO hotels(name,total_rooms) VALUES($1,5) RETURNING id", [`PDF check ${marker}`])).rows[0].id;
    const email = `id-pdf-${marker}@example.test`;
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);
    userId = (await pool.query("INSERT INTO users(email,name,password_hash,role,hotel_id) VALUES($1,$2,$3,'owner',$4) RETURNING id",
      [email, "Synthetic PDF verification", passwordHash, hotelId])).rows[0].id;
    const token = signToken({ userId: userId!, email, role: "owner", hotelId: hotelId!, tokenVersion: 0 });
    const headers = { Authorization: `Bearer ${token}` };
    const created = await fetch(`${base}/bookings`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelId, guestName: "Synthetic main guest", numberOfRooms: 1, numberOfPersons: 2,
        checkIn: "2026-10-12", checkOut: "2026-10-15", roomRent: 2500, addOns: 250, receipt: 1000, status: "confirmed" }) });
    assert.equal(created.status, 201);
    const createdBooking = await created.json() as { id: number };
    assert.equal(typeof createdBooking.id, "number");
    bookingId = createdBooking.id;
    const form = new FormData();
    form.append("guests", JSON.stringify([1, 2].map((personIndex) => ({
      personIndex, name: `Synthetic person ${personIndex}`, dateOfBirth: "2000-01-01",
      relation: personIndex === 1 ? "Main guest" : "Spouse",
    }))));
    for (let index = 0; index < 2; index++) {
      for (const side of ["front", "back"]) {
        const image = await sharp(Buffer.from(`<svg width="600" height="360"><rect width="600" height="360" fill="#eef3f9"/><text x="25" y="100" font-size="32">TEST ID NOT VALID</text><text x="25" y="180" font-size="28">Person ${index + 1} ${side}</text></svg>`)).png().toBuffer();
        form.append(`${side}_${index}`, new Blob([new Uint8Array(image)], { type: "image/png" }), `test-${index}-${side}.png`);
      }
    }
    const uploaded = await fetch(`${base}/bookings/${bookingId}/guests`, { method: "POST", headers, body: form });
    assert.equal(uploaded.status, 201, await uploaded.text());
    const stored = (await pool.query("SELECT id,front_id_key,back_id_key FROM booking_guests WHERE booking_id=$1 ORDER BY person_index", [bookingId])).rows;
    assert.equal(stored.length, 2);
    for (const guest of stored) {
      assert.match(guest.front_id_key, /^object:/);
      assert.match(guest.back_id_key, /^object:/);
      for (const side of ["front", "back"]) {
        const image = await fetch(`${base}/bookings/${bookingId}/guests/${guest.id}/id/${side}`, { headers });
        assert.equal(image.status, 200);
        assert.ok((await image.arrayBuffer()).byteLength > 0);
      }
    }
    const response = await fetch(`${base}/bookings/${bookingId}/pdf`, { headers });
    assert.equal(response.status, 200);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const file = path.join(directory, "booking.pdf");
    await writeFile(file, pdf);
    assert.match(execFileSync("pdfinfo", [file], { encoding: "utf8" }), /Pages:\s+1/);
    const images = execFileSync("pdfimages", ["-list", file], { encoding: "utf8" });
    assert.equal(images.split("\n").filter((line) => /^\s*1\s+\d+\s+image/.test(line)).length, 4);
    const keep = new FormData();
    keep.append("guests", JSON.stringify([1, 2].map((personIndex) => ({
      personIndex, name: `Synthetic person ${personIndex}`, dateOfBirth: "2000-01-01",
      relation: personIndex === 1 ? "Main guest" : "Spouse", keepFrontId: true, keepBackId: true,
    }))));
    const preserved = await fetch(`${base}/bookings/${bookingId}/guests`, { method: "POST", headers, body: keep });
    assert.equal(preserved.status, 201, await preserved.text());
    const after = (await pool.query("SELECT front_id_key,back_id_key FROM booking_guests WHERE booking_id=$1 ORDER BY person_index", [bookingId])).rows;
    assert.deepEqual(after, stored.map(({ front_id_key, back_id_key }) => ({ front_id_key, back_id_key })));
    console.info("Verified real upload, four private identity images, one-page PDF, and unchanged-document preservation.");
  } finally {
    if (bookingId) {
      const rows = (await pool.query("SELECT front_id_key,back_id_key FROM booking_guests WHERE booking_id=$1", [bookingId])).rows;
      await deleteIdImages(rows.flatMap((row) => [row.front_id_key, row.back_id_key]));
    }
    if (hotelId) {
      await pool.query("DELETE FROM audit_log WHERE hotel_id=$1", [hotelId]);
      await pool.query("DELETE FROM hotels WHERE id=$1", [hotelId]);
    }
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await rm(directory, { recursive: true, force: true });
    await pool.end();
  }
});
