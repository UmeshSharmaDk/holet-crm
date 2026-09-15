import { Router } from "express";
import { db, bookingsTable, agenciesTable, hotelsTable, usersTable } from "@workspace/db";
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

const router = Router();

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

    res.json(shapeBooking(row));
  } catch (error) {
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
