import PDFDocument from "pdfkit";
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { readIdImage } from "./idFileStore.js";

interface ReportBooking {
  id: number; guestName: string; guestEmail: string | null; guestPhone: string | null;
  checkIn: string; checkOut: string; numberOfRooms: number; numberOfPersons: number;
  roomRent: number; addOns: number; totalCost: number; receipt: number; balance: number;
  status: string; notes: string | null; createdAt: Date; updatedAt: Date;
  hotel: { name: string } | null; agency: { name: string } | null;
}
interface StoredGuest {
  id: number; person_index: number; name: string; date_of_birth: string | null; relation: string;
  front_id_key?: string | null; back_id_key?: string | null;
  front_id_data?: Buffer | null; back_id_data?: Buffer | null;
  front_id_checksum?: string | null; back_id_checksum?: string | null;
}
export class BookingDocumentError extends Error {}

// Only presence flags leave the server. This supports existing bytea scans
// and encrypted file references without migrating or exposing either storage.
export async function readGuestProfiles(bookingId: number) {
  const result = await pool.query(
    `SELECT id, person_index AS "personIndex", name,
      date_of_birth::text AS "dateOfBirth", relation,
      ((to_jsonb(g)->>'front_id_key') IS NOT NULL OR (to_jsonb(g)->>'front_id_data') IS NOT NULL) AS "hasFrontId",
      ((to_jsonb(g)->>'back_id_key') IS NOT NULL OR (to_jsonb(g)->>'back_id_data') IS NOT NULL) AS "hasBackId"
     FROM booking_guests g WHERE booking_id = $1 ORDER BY person_index`, [bookingId],
  );
  return result.rows;
}

async function imageFor(guest: StoredGuest, side: "front" | "back") {
  const key = guest[`${side}_id_key`];
  const legacy = guest[`${side}_id_data`];
  if (!key && !legacy) return null;
  try {
    const bytes = key ? await readIdImage(key) : legacy!;
    const checksum = guest[`${side}_id_checksum`];
    if (checksum && crypto.createHash("sha256").update(bytes).digest("hex") !== checksum) {
      throw new Error("Checksum mismatch");
    }
    return await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate().resize({ width: 1400, height: 1000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    throw new BookingDocumentError(`The ${side} identity document for guest ${guest.person_index + 1} cannot be read. Please re-upload it before exporting.`);
  }
}

export async function createBookingPdf(booking: ReportBooking): Promise<Buffer> {
  const result = await pool.query<StoredGuest>(
    "SELECT g.*, date_of_birth::text AS date_of_birth FROM booking_guests g WHERE booking_id = $1 ORDER BY person_index",
    [booking.id],
  );
  const guests = [];
  // Sequential decoding bounds the peak memory used by uploaded documents.
  for (const guest of result.rows) {
    guests.push({ ...guest, front: await imageFor(guest, "front"), back: await imageFor(guest, "back") });
  }
  const fontCandidates = [
    path.resolve("assets/fonts/NotoSansDevanagari.ttf"),
    path.resolve("artifacts/api-server/assets/fonts/NotoSansDevanagari.ttf"),
  ];
  const font = fontCandidates.find((candidate) => fs.existsSync(candidate));
  if (!font) throw new Error("Booking report font is missing.");
  const doc = new PDFDocument({ size: "A4", margin: 30, bufferPages: true,
    info: { Title: `Booking ${booking.id}`, Author: "Hotel CRM" } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("Report", font).font("Report");
  const left = 30, width = doc.page.width - 60, bottom = doc.page.height - 48;
  const ink = "#203b5c", muted = "#5b6572";
  let y = 30;
  function pageSpace(height: number) {
    if (y + height > bottom) { doc.addPage(); y = 30; }
  }
  function text(value: unknown, x: number, top: number, w: number, size = 9, color = ink) {
    doc.fontSize(size).fillColor(color).text(String(value ?? "Not recorded"), x, top, { width: w, lineGap: 1 });
  }
  function section(title: string) {
    pageSpace(25);
    doc.rect(left, y, width, 20).fill("#edf2f7");
    text(title, left + 7, y + 3, width - 14, 10);
    y += 27;
  }
  function fieldRows(fields: Array<[string, unknown]>) {
    const col = width / 2;
    for (let i = 0; i < fields.length; i += 2) {
      const row = fields.slice(i, i + 2);
      const heights = row.map(([, value]) => doc.fontSize(9).heightOfString(String(value ?? "Not recorded"), { width: col - 14 }));
      const height = Math.max(...heights) + 16;
      pageSpace(height);
      row.forEach(([label, value], index) => {
        const x = left + index * col;
        text(label, x, y, col - 14, 7, muted);
        text(value, x, y + 10, col - 14);
      });
      y += height;
    }
    y += 4;
  }
  const date = (value: string | Date | null) => {
    if (!value) return "Not recorded";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-");
      return `${day}/${month}/${year}`;
    }
    return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  };
  const nights = Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86400000);
  text(booking.hotel?.name ?? "Hotel CRM", left, y, width, 18);
  y += 28;
  text(`BOOKING FORM  #${booking.id}  |  ${booking.status.replaceAll("_", " ").toUpperCase()}`, left, y, width, 11);
  y += 25;
  section("Booking details");
  fieldRows([
    ["Main guest", booking.guestName], ["Hotel", booking.hotel?.name],
    ["Email", booking.guestEmail], ["Phone", booking.guestPhone],
    ["Check-in", date(booking.checkIn)], ["Check-out", date(booking.checkOut)],
    ["Stay", `${nights} night(s) · ${booking.numberOfRooms} room(s) · ${booking.numberOfPersons} person(s)`],
    ["Travel agency", booking.agency?.name ?? "Direct booking"],
    ["Created", date(booking.createdAt)], ["Last updated", date(booking.updatedAt)],
  ]);
  section("Financial summary (INR)");
  const amounts: Array<[string, number]> = [
    ["Room rent", booking.roomRent], ["Add-ons", booking.addOns], ["Total cost", booking.totalCost],
    ["Amount received", booking.receipt], ["Balance due", booking.balance],
  ];
  amounts.forEach(([label, amount], index) => {
    const col = width / amounts.length;
    text(label, left + index * col, y, col - 5, 7, muted);
    text(amount.toFixed(2), left + index * col, y + 12, col - 5, 11);
  });
  y += 36;
  if (booking.notes) {
    section("Notes");
    // PDFKit flows lengthy notes onto subsequent pages rather than truncating.
    doc.fontSize(9).fillColor(ink).text(booking.notes, left, y, { width, lineGap: 1 });
    y = doc.y + 10;
  }
  section("Guest profiles & identity documents");
  if (!guests.length) {
    text("No guest profiles or identity documents have been recorded.", left, y, width);
    y += 24;
  }
  const columns = guests.length <= 2 ? 1 : 2;
  const gap = 10, cardWidth = (width - gap * (columns - 1)) / columns;
  const imageHeight = columns === 1 ? 102 : 72;
  for (let i = 0; i < guests.length; i += columns) {
    const row = guests.slice(i, i + columns);
    const headings = row.map((guest) => `${guest.person_index + 1}. ${guest.name}\nDOB: ${date(guest.date_of_birth)} · ${guest.person_index === 0 ? "Main guest" : guest.relation}`);
    const headingHeight = Math.max(...headings.map((heading) => doc.fontSize(9).heightOfString(heading, { width: cardWidth - 14 })));
    const cardHeight = headingHeight + imageHeight + 35;
    pageSpace(cardHeight + 8);
    row.forEach((guest, index) => {
      const x = left + index * (cardWidth + gap);
      doc.rect(x, y, cardWidth, cardHeight).lineWidth(0.5).stroke("#d8dfe7");
      text(headings[index], x + 7, y + 5, cardWidth - 14);
      const imageTop = y + headingHeight + 19, imageWidth = (cardWidth - 21) / 2;
      (["front", "back"] as const).forEach((side, sideIndex) => {
        const imageX = x + 7 + sideIndex * (imageWidth + 7);
        text(`ID ${side}`, imageX, imageTop - 11, imageWidth, 7, muted);
        const image = guest[side];
        if (image) doc.image(image, imageX, imageTop, { fit: [imageWidth, imageHeight], align: "center", valign: "center" });
        else text("Not uploaded", imageX, imageTop + 15, imageWidth, 8, muted);
      });
    });
    y += cardHeight + 8;
  }
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    // Place within the bottom margin without causing PDFKit to add a page.
    doc.page.margins.bottom = 0;
    text(`Confidential · Booking #${booking.id} · Page ${index + 1} of ${range.count}`, left, doc.page.height - 27, width, 7, muted);
  }
  doc.end();
  return finished;
}
