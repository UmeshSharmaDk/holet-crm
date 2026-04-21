import { Router } from "express";
import { db, bookingsTable, agenciesTable, hotelsTable, usersTable } from "@workspace/db";
import { eq, and, between, sql } from "drizzle-orm";
import { requireAuth, requireOwnerOrAdmin } from "../middlewares/auth.js";
import { sendBookingUpdateEmail, BookingComparison } from "../lib/email.js";

const router = Router();

function calcTotalAndBalance(roomRent: number, addOns: number, receipt: number) {
  const totalCost = roomRent + addOns;
  const balance = totalCost - receipt;
  return { totalCost, balance };
}

async function enrichBooking(booking: any) {
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
  return {
    ...booking,
    roomRent: parseFloat(booking.roomRent),
    addOns: parseFloat(booking.addOns),
    totalCost: parseFloat(booking.totalCost),
    receipt: parseFloat(booking.receipt),
    balance: parseFloat(booking.balance),
    agency,
    hotel,
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

    const enriched = await Promise.all(bookings.map(enrichBooking));
    res.json(enriched);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, parseInt(req.params.id)));
    if (!booking) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(await enrichBooking(booking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { guestName, guestEmail, guestPhone, roomNumber, roomType, checkIn, checkOut, roomRent, addOns, receipt, notes, status, hotelId, agencyId } = req.body;
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
      roomNumber: roomNumber ?? null,
      roomType: roomType ?? null,
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
    const bookingId = parseInt(req.params.id);
    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const { guestName, guestEmail, guestPhone, roomNumber, roomType, checkIn, checkOut, roomRent, addOns, receipt, notes, status, agencyId } = req.body;
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
      { key: "roomNumber", label: "Room Number" },
      { key: "roomType", label: "Room Type" },
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
      roomNumber: roomNumber !== undefined ? roomNumber : existing.roomNumber,
      roomType: roomType !== undefined ? roomType : existing.roomType,
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
    const bookingId = parseInt(req.params.id);
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
    await db.delete(bookingsTable).where(eq(bookingsTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
