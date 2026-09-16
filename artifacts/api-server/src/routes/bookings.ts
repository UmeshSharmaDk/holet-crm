import { Router } from "express";
import { db, bookingsTable, bookingGuestsTable, agenciesTable, hotelsTable, usersTable } from "@workspace/db";
import { eq, and, between, sql } from "drizzle-orm";
import { requireAuth, requireOwnerOrAdmin } from "../middlewares/auth.js";
import { requireHotelScope, hotelFilter, denyOutOfScope, type HotelScope } from "../lib/scope.js";
import {
  parseIdParam,
  parseOptionalId,
  money,
  count,
  isoDate,
  text,
  optionalText,
  optionalEmail,
  oneOf,
  BOOKING_STATUSES,
  ValidationError,
  handleValidationError,
} from "../lib/validate.js";
import { sendBookingUpdateEmail, BookingComparison } from "../lib/email.js";
import multer from "multer";
import rateLimit from "express-rate-limit";

const router = Router();

/** A booking may record at most this many guests, each with a front and back ID. */
const MAX_GUESTS = 12;

/**
 * Generous for a photograph of an identity card, and the point at which the
 * memory cost stops being reasonable.
 *
 * These files are buffered in memory for the whole request, so the ceiling is
 * files x fileSize held at once, per concurrent upload. At the previous
 * 24 x 8 MB that was 192 MB for a single request from any authenticated user
 * of the hotel — enough for a handful of concurrent uploads to exhaust the
 * container and take the API down for every tenant.
 */
const MAX_ID_IMAGE_BYTES = 2 * 1024 * 1024;

const guestUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_GUESTS * 2,
    fileSize: MAX_ID_IMAGE_BYTES,
    // The roster arrives as one JSON field; cap it so the text side cannot be
    // used to do what the file limits now prevent.
    fields: 4,
    fieldSize: 64 * 1024,
    parts: MAX_GUESTS * 2 + 4,
  },
  fileFilter: (_req, file, callback) => {
    // Declared by the client, so it gates storage only; what is served back is
    // re-checked against the same allowlist on the way out.
    callback(null, ID_IMAGE_MIME.has(file.mimetype));
  },
});

/**
 * Size limits bound a single request; this bounds how many a caller can make.
 * Without it the ceiling is only the global limiter, which is far too generous
 * for a route that buffers images in memory.
 */
const guestUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env["GUEST_UPLOAD_RATE_LIMIT_PER_MINUTE"] ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? "anonymous"),
  message: { error: "Too Many Requests", message: "Too many guest uploads, please slow down." },
});

function calcTotalAndBalance(roomRent: number, addOns: number, receipt: number) {
  const totalCost = roomRent + addOns;
  const balance = totalCost - receipt;
  return { totalCost, balance };
}

/**
 * Bookings joined to their agency and hotel in a single round-trip. The old
 * per-booking lookups meant a 500-row list issued ~1000 queries against a pool
 * of 20.
 */
function bookingQuery() {
  return db
    .select({ booking: bookingsTable, agency: agenciesTable, hotel: hotelsTable })
    .from(bookingsTable)
    .leftJoin(agenciesTable, eq(bookingsTable.agencyId, agenciesTable.id))
    .leftJoin(hotelsTable, eq(bookingsTable.hotelId, hotelsTable.id));
}

type BookingRow = Awaited<ReturnType<typeof bookingQuery>>[number];

function shapeBooking(row: BookingRow) {
  const b = row.booking;
  return {
    ...b,
    roomRent: parseFloat(b.roomRent),
    addOns: parseFloat(b.addOns),
    totalCost: parseFloat(b.totalCost),
    receipt: parseFloat(b.receipt),
    balance: parseFloat(b.balance),
    agency: row.agency,
    hotel: row.hotel,
  };
}

async function fetchBooking(id: number) {
  const [row] = await bookingQuery().where(eq(bookingsTable.id, id));
  return row ?? null;
}

/**
 * Guest roster for a booking. The ID scans themselves are deliberately not
 * selected — only whether one exists — so the blobs never ride along in a
 * booking payload; they are fetched one at a time through the guarded
 * /guests/:guestId/id/:side route.
 */
async function fetchGuests(bookingId: number) {
  return db
    .select({
      id: bookingGuestsTable.id,
      personIndex: bookingGuestsTable.personIndex,
      name: bookingGuestsTable.name,
      dateOfBirth: bookingGuestsTable.dateOfBirth,
      relation: bookingGuestsTable.relation,
      hasFrontId: sql<boolean>`${bookingGuestsTable.frontIdData} IS NOT NULL`,
      hasBackId: sql<boolean>`${bookingGuestsTable.backIdData} IS NOT NULL`,
    })
    .from(bookingGuestsTable)
    .where(eq(bookingGuestsTable.bookingId, bookingId))
    .orderBy(bookingGuestsTable.personIndex);
}

async function fetchBookingWithGuests(id: number) {
  const row = await fetchBooking(id);
  if (!row) return null;
  return { ...shapeBooking(row), guests: await fetchGuests(id) };
}

/**
 * An agency may only be attached to a booking of the same hotel. Without this
 * a booking could be filed under another tenant's agency and pollute their
 * revenue analytics.
 */
async function resolveAgencyId(agencyId: number | null, hotelId: number): Promise<number | null> {
  if (agencyId == null) return null;
  const [agency] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, agencyId));
  if (!agency || agency.hotelId !== hotelId) {
    throw new ValidationError("agencyId does not belong to this hotel");
  }
  return agency.id;
}

router.get("/", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const { month, year, date, agencyId } = req.query;
    const scope = req.hotelScope as HotelScope;

    const conditions: any[] = [];
    const scopeFilter = hotelFilter(scope, bookingsTable.hotelId);
    if (scopeFilter) conditions.push(scopeFilter);

    if (agencyId !== undefined) {
      const aid = agencyId as string;
      if (aid === "null" || aid === "direct" || aid === "") {
        conditions.push(sql`${bookingsTable.agencyId} IS NULL`);
      } else {
        const parsed = Number.parseInt(aid, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          res.status(400).json({ error: "Bad Request", message: "agencyId must be a positive integer" });
          return;
        }
        conditions.push(eq(bookingsTable.agencyId, parsed));
      }
    }

    if (date) {
      conditions.push(eq(bookingsTable.checkIn, isoDate(date, "date")));
    } else if (month && year) {
      const m = Number.parseInt(month as string, 10);
      const y = Number.parseInt(year as string, 10);
      if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 1970 || y > 9999) {
        res.status(400).json({ error: "Bad Request", message: "month must be 1-12 and year must be a valid year" });
        return;
      }
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0);
      const end = `${y}-${String(m).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      conditions.push(between(bookingsTable.checkIn, start, end));
    }

    const rows = conditions.length > 0
      ? await bookingQuery().where(and(...conditions)).orderBy(bookingsTable.checkIn)
      : await bookingQuery().orderBy(bookingsTable.checkIn);

    res.json(rows.map(shapeBooking));
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.id);
    if (bookingId === null) return;

    const row = await fetchBooking(bookingId);
    if (!row) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, row.booking.hotelId)) return;

    res.json({ ...shapeBooking(row), guests: await fetchGuests(bookingId) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Guest ID scans are the most sensitive data the platform holds. The content
 * type is taken from a fixed allowlist rather than the uploader's declared
 * type, the filename is sanitised before it reaches a header, and nosniff is
 * set — otherwise an upload declaring `image/svg+xml` would be served as
 * script on the API origin.
 */
const ID_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function safeDownloadName(raw: string | null | undefined, fallback: string): string {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  return cleaned || fallback;
}

router.get("/:bookingId/guests/:guestId/id/:side", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.bookingId, "bookingId");
    if (bookingId === null) return;
    const guestId = parseIdParam(res, req.params.guestId, "guestId");
    if (guestId === null) return;

    const side = req.params.side === "front" ? "front" : req.params.side === "back" ? "back" : null;
    if (!side) {
      res.status(400).json({ error: "Bad Request", message: "ID side must be front or back" });
      return;
    }

    const [booking] = await db.select({ hotelId: bookingsTable.hotelId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    if (!booking) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, booking.hotelId)) return;

    const [guest] = await db.select().from(bookingGuestsTable).where(and(
      eq(bookingGuestsTable.id, guestId),
      eq(bookingGuestsTable.bookingId, bookingId),
    ));
    const data = side === "front" ? guest?.frontIdData : guest?.backIdData;
    const mimeType = side === "front" ? guest?.frontIdMimeType : guest?.backIdMimeType;
    const fileName = side === "front" ? guest?.frontIdName : guest?.backIdName;
    if (!guest || !data) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    res.setHeader("Content-Type", mimeType && ID_IMAGE_MIME.has(mimeType) ? mimeType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${safeDownloadName(fileName, `${side}-id.jpg`)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/:id/guests", requireAuth, guestUploadLimiter, requireHotelScope, guestUpload.any(), async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.id);
    if (bookingId === null) return;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!booking) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, booking.hotelId)) return;

    const guests = JSON.parse(String(req.body.guests ?? "[]")) as Array<{
      personIndex: number;
      name: string;
      dateOfBirth?: string | null;
      relation: string;
      keepFrontId?: boolean | string;
      keepBackId?: boolean | string;
    }>;
    if (!Array.isArray(guests) || guests.length !== booking.numberOfPersons || guests.length > MAX_GUESTS) {
      res.status(400).json({ error: "Bad Request", message: "Guest details must match the number of persons" });
      return;
    }

    const existing = await db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.bookingId, bookingId));
    const existingByIndex = new Map(existing.map((guest) => [guest.personIndex, guest]));
    const files = new Map(
      ((req.files ?? []) as Express.Multer.File[]).map((file) => [file.fieldname, file]),
    );

    const rows = guests.map((guest) => {
      // personIndex addresses a row and a file field, so it must be a real
      // integer rather than whatever the client sent.
      const personIndex = count(guest.personIndex, "personIndex", NaN) - 1;
      if (!Number.isInteger(personIndex) || personIndex < 0 || personIndex >= guests.length) {
        throw new ValidationError("personIndex is out of range");
      }
      const previous = existingByIndex.get(personIndex);
      const frontFile = files.get(`front_${personIndex}`);
      const backFile = files.get(`back_${personIndex}`);
      const keepFront = guest.keepFrontId === true || guest.keepFrontId === "true";
      const keepBack = guest.keepBackId === true || guest.keepBackId === "true";

      return {
        bookingId,
        personIndex,
        name: text(guest.name, "guest name", 200),
        dateOfBirth: guest.dateOfBirth ? isoDate(guest.dateOfBirth, "dateOfBirth") : null,
        relation: text(guest.relation, "relation", 100),
        frontIdData: frontFile?.buffer ?? (keepFront ? previous?.frontIdData ?? null : null),
        frontIdMimeType: frontFile?.mimetype ?? (keepFront ? previous?.frontIdMimeType ?? null : null),
        frontIdName: frontFile?.originalname ?? (keepFront ? previous?.frontIdName ?? null : null),
        backIdData: backFile?.buffer ?? (keepBack ? previous?.backIdData ?? null : null),
        backIdMimeType: backFile?.mimetype ?? (keepBack ? previous?.backIdMimeType ?? null : null),
        backIdName: backFile?.originalname ?? (keepBack ? previous?.backIdName ?? null : null),
        updatedAt: new Date(),
      };
    });

    await db.transaction(async (tx) => {
      await tx.delete(bookingGuestsTable).where(eq(bookingGuestsTable.bookingId, bookingId));
      await tx.insert(bookingGuestsTable).values(rows);
    });

    res.status(201).json(await fetchBookingWithGuests(bookingId));
  } catch (error) {
    if (handleValidationError(res, error)) return;
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Bad Request", message: "Invalid guest details" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const scope = req.hotelScope as HotelScope;
    const body = req.body ?? {};

    // An admin scoped to "all hotels" must name the hotel explicitly.
    const requestedHotelId = parseOptionalId(body.hotelId);
    const targetHotelId = scope.kind === "hotel" ? scope.hotelId : requestedHotelId ?? null;
    if (!targetHotelId) {
      res.status(400).json({ error: "Bad Request", message: "hotelId is required" });
      return;
    }
    if (scope.kind === "hotel" && requestedHotelId != null && requestedHotelId !== scope.hotelId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot create a booking for another hotel" });
      return;
    }

    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, targetHotelId));
    if (!hotel) {
      res.status(400).json({ error: "Bad Request", message: "hotelId does not exist" });
      return;
    }

    const guestName = text(body.guestName, "guestName", 200);
    const checkIn = isoDate(body.checkIn, "checkIn");
    const checkOut = isoDate(body.checkOut, "checkOut");
    if (checkOut <= checkIn) {
      throw new ValidationError("checkOut must be after checkIn");
    }
    const rr = money(body.roomRent, "roomRent");
    const ao = money(body.addOns, "addOns", 0);
    const rc = money(body.receipt, "receipt", 0);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);
    const agencyId = await resolveAgencyId(parseOptionalId(body.agencyId) ?? null, targetHotelId);

    const [created] = await db.insert(bookingsTable).values({
      guestName,
      guestEmail: optionalEmail(body.guestEmail, "guestEmail"),
      guestPhone: optionalText(body.guestPhone, "guestPhone", 40),
      numberOfRooms: count(body.numberOfRooms, "numberOfRooms", 1),
      numberOfPersons: count(body.numberOfPersons, "numberOfPersons", 1),
      checkIn,
      checkOut,
      roomRent: String(rr),
      addOns: String(ao),
      totalCost: String(totalCost),
      receipt: String(rc),
      balance: String(balance),
      notes: optionalText(body.notes, "notes", 2000),
      status: oneOf(body.status, "status", BOOKING_STATUSES, "confirmed"),
      hotelId: targetHotelId,
      agencyId,
    }).returning();

    const row = await fetchBooking(created.id);
    res.status(201).json(row ? shapeBooking(row) : null);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.id);
    if (bookingId === null) return;

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, existing.hotelId)) return;

    const body = req.body ?? {};
    const { guestName, guestEmail, guestPhone, numberOfRooms, numberOfPersons, checkIn, checkOut, roomRent, addOns, receipt, notes, status, agencyId } = body;

    const rr = roomRent !== undefined ? money(roomRent, "roomRent") : parseFloat(existing.roomRent);
    const ao = addOns !== undefined ? money(addOns, "addOns") : parseFloat(existing.addOns);
    const rc = receipt !== undefined ? money(receipt, "receipt") : parseFloat(existing.receipt);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);

    const nextCheckIn = checkIn !== undefined ? isoDate(checkIn, "checkIn") : existing.checkIn;
    const nextCheckOut = checkOut !== undefined ? isoDate(checkOut, "checkOut") : existing.checkOut;
    if (nextCheckOut <= nextCheckIn) {
      throw new ValidationError("checkOut must be after checkIn");
    }

    const nextAgencyId = agencyId !== undefined
      ? await resolveAgencyId(parseOptionalId(agencyId) ?? null, existing.hotelId)
      : existing.agencyId;

    const changes: BookingComparison[] = [];
    const fields: { key: string; label: string }[] = [
      { key: "guestName", label: "Guest Name" },
      { key: "checkIn", label: "Check-In" },
      { key: "checkOut", label: "Check-Out" },
      { key: "status", label: "Status" },
      { key: "numberOfRooms", label: "Number of Rooms" },
      { key: "numberOfPersons", label: "Number of Persons" },
    ];
    for (const f of fields) {
      const newVal = body[f.key];
      const oldVal = (existing as any)[f.key];
      if (newVal !== undefined && String(newVal) !== String(oldVal ?? "")) {
        changes.push({ field: f.label, oldValue: String(oldVal ?? ""), newValue: String(newVal) });
      }
    }
    if (roomRent !== undefined && rr !== parseFloat(existing.roomRent)) {
      changes.push({ field: "Room Rent", oldValue: `₹${existing.roomRent}`, newValue: `₹${rr}` });
    }
    if (receipt !== undefined && rc !== parseFloat(existing.receipt)) {
      changes.push({ field: "Receipt", oldValue: `₹${existing.receipt}`, newValue: `₹${rc}` });
    }

    const [updated] = await db.update(bookingsTable).set({
      guestName: guestName !== undefined ? text(guestName, "guestName", 200) : existing.guestName,
      guestEmail: guestEmail !== undefined ? optionalEmail(guestEmail, "guestEmail") : existing.guestEmail,
      guestPhone: guestPhone !== undefined ? optionalText(guestPhone, "guestPhone", 40) : existing.guestPhone,
      numberOfRooms: numberOfRooms !== undefined ? count(numberOfRooms, "numberOfRooms", existing.numberOfRooms) : existing.numberOfRooms,
      numberOfPersons: numberOfPersons !== undefined ? count(numberOfPersons, "numberOfPersons", existing.numberOfPersons) : existing.numberOfPersons,
      checkIn: nextCheckIn,
      checkOut: nextCheckOut,
      roomRent: String(rr),
      addOns: String(ao),
      totalCost: String(totalCost),
      receipt: String(rc),
      balance: String(balance),
      notes: notes !== undefined ? optionalText(notes, "notes", 2000) : existing.notes,
      status: status !== undefined ? oneOf(status, "status", BOOKING_STATUSES) : existing.status,
      agencyId: nextAgencyId,
      updatedAt: new Date(),
    }).where(eq(bookingsTable.id, bookingId)).returning();

    if (changes.length > 0) {
      const owners = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(and(eq(usersTable.role, "owner"), eq(usersTable.hotelId, existing.hotelId)));
      for (const owner of owners) {
        sendBookingUpdateEmail(owner.email, bookingId, updated.guestName, changes).catch(console.error);
      }
    }

    const row = await fetchBooking(bookingId);
    res.json(row ? shapeBooking(row) : null);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/:id/payment", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.id);
    if (bookingId === null) return;

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, existing.hotelId)) return;

    const rc = money(req.body?.receipt, "receipt");
    const rr = parseFloat(existing.roomRent);
    const ao = parseFloat(existing.addOns);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);

    await db.update(bookingsTable).set({
      receipt: String(rc),
      totalCost: String(totalCost),
      balance: String(balance),
      updatedAt: new Date(),
    }).where(eq(bookingsTable.id, bookingId));

    const row = await fetchBooking(bookingId);
    res.json(row ? shapeBooking(row) : null);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireAuth, requireOwnerOrAdmin, requireHotelScope, async (req, res) => {
  try {
    const bookingId = parseIdParam(res, req.params.id);
    if (bookingId === null) return;

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, existing.hotelId)) return;

    await db.delete(bookingsTable).where(eq(bookingsTable.id, bookingId));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
