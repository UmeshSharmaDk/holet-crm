import { Router } from "express";
import { db, bookingsTable, bookingGuestsTable, agenciesTable, hotelsTable, usersTable } from "@workspace/db";
import { eq, and, between, sql } from "drizzle-orm";
import { requireAuth, requireOwnerOrAdmin } from "../middlewares/auth.js";
import { sendBookingUpdateEmail, BookingComparison } from "../lib/email.js";
import multer from "multer";

const router = Router();
const guestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 24, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  },
});

function calcTotalAndBalance(roomRent: number, addOns: number, receipt: number) {
  const totalCost = roomRent + addOns;
  const balance = totalCost - receipt;
  return { totalCost, balance };
}

async function enrichBooking(booking: any, includeGuests = false) {
  let agency = null;
  let hotel = null;
  if (booking.agencyId) {
    const [a] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, booking.agencyId));
    agency = a ?? null;
  }
  if (booking.hotelId) {
    const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, booking.hotelId));
    hotel = h ?? null;
  }
  const guests = includeGuests
    ? await db
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
      .where(eq(bookingGuestsTable.bookingId, booking.id))
      .orderBy(bookingGuestsTable.personIndex)
    : undefined;

  return {
    ...booking,
    roomRent: parseFloat(booking.roomRent),
    addOns: parseFloat(booking.addOns),
    totalCost: parseFloat(booking.totalCost),
    receipt: parseFloat(booking.receipt),
    balance: parseFloat(booking.balance),
    agency,
    hotel,
    ...(guests ? { guests } : {}),
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { month, year, hotelId: queryHotelId, date, agencyId } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;

    const conditions: any[] = [];
    if (effectiveHotelId) conditions.push(eq(bookingsTable.hotelId, effectiveHotelId));
    if (agencyId !== undefined) {
      const aid = agencyId as string;
      if (aid === "null" || aid === "direct" || aid === "") {
        conditions.push(sql`${bookingsTable.agencyId} IS NULL`);
      } else {
        conditions.push(eq(bookingsTable.agencyId, parseInt(aid)));
      }
    }

    if (date) {
      conditions.push(eq(bookingsTable.checkIn, date as string));
    } else if (month && year) {
      const m = parseInt(month as string);
      const y = parseInt(year as string);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const endDate = new Date(y, m, 0);
      const end = `${y}-${String(m).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      conditions.push(between(bookingsTable.checkIn, start, end));
    }

    const bookings = conditions.length > 0
      ? await db.select().from(bookingsTable).where(and(...conditions)).orderBy(bookingsTable.checkIn)
      : await db.select().from(bookingsTable).orderBy(bookingsTable.checkIn);

    const enriched = await Promise.all(bookings.map((booking) => enrichBooking(booking)));
    res.json(enriched);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, parseInt(req.params.id as string)));
    if (!booking) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(await enrichBooking(booking, true));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:bookingId/guests/:guestId/id/:side", requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId as string);
    const guestId = parseInt(req.params.guestId as string);
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
    if (req.user?.role !== "admin" && req.user?.hotelId !== booking.hotelId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

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

    res.setHeader("Content-Type", mimeType ?? "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="${fileName ?? `${side}-id.jpg`}"`);
    res.send(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/:id/guests", requireAuth, guestUpload.any(), async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id as string);
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!booking) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (req.user?.role !== "admin" && req.user?.hotelId !== booking.hotelId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const guests = JSON.parse(String(req.body.guests ?? "[]")) as Array<{
      personIndex: number;
      name: string;
      dateOfBirth?: string | null;
      relation: string;
      keepFrontId?: boolean | string;
      keepBackId?: boolean | string;
    }>;
    if (!Array.isArray(guests) || guests.length !== booking.numberOfPersons || guests.length > 12) {
      res.status(400).json({ error: "Bad Request", message: "Guest details must match the number of persons" });
      return;
    }
    if (guests.some((guest) => !guest.name?.trim() || !guest.relation?.trim())) {
      res.status(400).json({ error: "Bad Request", message: "Each guest needs a name and relation" });
      return;
    }

    const existing = await db.select().from(bookingGuestsTable).where(eq(bookingGuestsTable.bookingId, bookingId));
    const existingByIndex = new Map(existing.map((guest) => [guest.personIndex, guest]));
    const files = new Map(
      ((req.files ?? []) as Express.Multer.File[]).map((file) => [file.fieldname, file]),
    );

    const rows = guests.map((guest) => {
      const personIndex = Number(guest.personIndex);
      const previous = existingByIndex.get(personIndex);
      const frontFile = files.get(`front_${personIndex}`);
      const backFile = files.get(`back_${personIndex}`);
      const keepFront = guest.keepFrontId === true || guest.keepFrontId === "true";
      const keepBack = guest.keepBackId === true || guest.keepBackId === "true";

      return {
        bookingId,
        personIndex,
        name: guest.name.trim(),
        dateOfBirth: guest.dateOfBirth || null,
        relation: guest.relation.trim(),
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

    res.status(201).json(await enrichBooking(booking, true));
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Bad Request", message: "Invalid guest details" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { guestName, guestEmail, guestPhone, numberOfRooms, numberOfPersons, checkIn, checkOut, roomRent, addOns, receipt, notes, status, hotelId, agencyId } = req.body;
    const effectiveHotelId = req.user?.role === "admin" ? hotelId : req.user?.hotelId;
    if (!guestName || !checkIn || !checkOut || roomRent === undefined || addOns === undefined || !effectiveHotelId) {
      res.status(400).json({ error: "Bad Request", message: "Required fields missing" });
      return;
    }
    const rr = parseFloat(roomRent);
    const ao = parseFloat(addOns);
    const rc = parseFloat(receipt ?? 0);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);

    const [booking] = await db.insert(bookingsTable).values({
      guestName,
      guestEmail: guestEmail ?? null,
      guestPhone: guestPhone ?? null,
      numberOfRooms: numberOfRooms != null ? parseInt(String(numberOfRooms)) : 1,
      numberOfPersons: numberOfPersons != null ? parseInt(String(numberOfPersons)) : 1,
      checkIn,
      checkOut,
      roomRent: String(rr),
      addOns: String(ao),
      totalCost: String(totalCost),
      receipt: String(rc),
      balance: String(balance),
      notes: notes ?? null,
      status: status ?? "confirmed",
      hotelId: effectiveHotelId,
      agencyId: agencyId ?? null,
    }).returning();

    res.status(201).json(await enrichBooking(booking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id as string);
    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const { guestName, guestEmail, guestPhone, numberOfRooms, numberOfPersons, checkIn, checkOut, roomRent, addOns, receipt, notes, status, agencyId } = req.body;
    const rr = roomRent !== undefined ? parseFloat(roomRent) : parseFloat(existing.roomRent);
    const ao = addOns !== undefined ? parseFloat(addOns) : parseFloat(existing.addOns);
    const rc = receipt !== undefined ? parseFloat(receipt) : parseFloat(existing.receipt);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);

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
      const newVal = req.body[f.key];
      const oldVal = (existing as any)[f.key];
      if (newVal !== undefined && String(newVal) !== String(oldVal ?? "")) {
        changes.push({ field: f.label, oldValue: String(oldVal ?? ""), newValue: String(newVal) });
      }
    }
    if (roomRent !== undefined && parseFloat(roomRent) !== parseFloat(existing.roomRent)) {
      changes.push({ field: "Room Rent", oldValue: `$${existing.roomRent}`, newValue: `$${roomRent}` });
    }
    if (receipt !== undefined && parseFloat(receipt) !== parseFloat(existing.receipt)) {
      changes.push({ field: "Receipt", oldValue: `$${existing.receipt}`, newValue: `$${receipt}` });
    }

    const [updated] = await db.update(bookingsTable).set({
      guestName: guestName ?? existing.guestName,
      guestEmail: guestEmail !== undefined ? guestEmail : existing.guestEmail,
      guestPhone: guestPhone !== undefined ? guestPhone : existing.guestPhone,
      numberOfRooms: numberOfRooms !== undefined ? parseInt(String(numberOfRooms)) : existing.numberOfRooms,
      numberOfPersons: numberOfPersons !== undefined ? parseInt(String(numberOfPersons)) : existing.numberOfPersons,
      checkIn: checkIn ?? existing.checkIn,
      checkOut: checkOut ?? existing.checkOut,
      roomRent: String(rr),
      addOns: String(ao),
      totalCost: String(totalCost),
      receipt: String(rc),
      balance: String(balance),
      notes: notes !== undefined ? notes : existing.notes,
      status: status ?? existing.status,
      agencyId: agencyId !== undefined ? agencyId : existing.agencyId,
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

    res.json(await enrichBooking(updated));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/:id/payment", requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id as string);
    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    const rc = parseFloat(req.body.receipt);
    const rr = parseFloat(existing.roomRent);
    const ao = parseFloat(existing.addOns);
    const { totalCost, balance } = calcTotalAndBalance(rr, ao, rc);

    const [updated] = await db.update(bookingsTable).set({
      receipt: String(rc),
      totalCost: String(totalCost),
      balance: String(balance),
      updatedAt: new Date(),
    }).where(eq(bookingsTable.id, bookingId)).returning();

    res.json(await enrichBooking(updated));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireAuth, requireOwnerOrAdmin, async (req, res) => {
  try {
    await db.delete(bookingsTable).where(eq(bookingsTable.id, parseInt(req.params.id as string)));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
