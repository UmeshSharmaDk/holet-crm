import { Router } from "express";
import { db, bookingsTable, hotelsTable } from "@workspace/db";
import { eq, and, sql, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

router.get("/stats", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;

    const today = todayStr();
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;

    const hotelCondition = effectiveHotelId ? eq(bookingsTable.hotelId, effectiveHotelId) : sql`1=1`;

    const [todayCheckins] = await db
      .select({ count: count() })
      .from(bookingsTable)
      .where(and(hotelCondition as any, eq(bookingsTable.checkIn, today)));

    const [todayCheckouts] = await db
      .select({ count: count() })
      .from(bookingsTable)
      .where(and(hotelCondition as any, eq(bookingsTable.checkOut, today)));

    const [totalBookings] = await db
      .select({ count: count() })
      .from(bookingsTable)
      .where(hotelCondition as any);

    const [occupiedResult] = await db
      .select({ total: sql<number>`coalesce(sum(${bookingsTable.numberOfRooms}), 0)` })
      .from(bookingsTable)
      .where(and(
        hotelCondition as any,
        sql`${bookingsTable.checkIn} <= ${today}`,
        sql`${bookingsTable.checkOut} > ${today}`,
        sql`${bookingsTable.status} IN ('confirmed', 'checked_in')`
      ));

    let totalRooms = 0;
    if (effectiveHotelId) {
      const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, effectiveHotelId));
      totalRooms = hotel?.totalRooms ?? 0;
    } else {
      const [roomsResult] = await db.select({ total: sql<number>`sum(${hotelsTable.totalRooms})` }).from(hotelsTable);
      totalRooms = Number(roomsResult?.total ?? 0);
    }

    const [monthRevenue] = await db
      .select({ total: sql<number>`sum(cast(${bookingsTable.totalCost} as decimal))` })
      .from(bookingsTable)
      .where(and(
        hotelCondition as any,
        sql`${bookingsTable.checkIn} >= ${firstOfMonth}`,
        sql`${bookingsTable.checkIn} <= ${lastOfMonth}`
      ));

    const occupiedRooms = Number(occupiedResult?.total ?? 0);
    const occupancyPercentage = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    res.json({
      todayCheckins: todayCheckins.count,
      todayCheckouts: todayCheckouts.count,
      totalBookings: totalBookings.count,
      occupiedRooms,
      totalRooms,
      occupancyPercentage,
      monthlyRevenue: Number(monthRevenue?.total ?? 0),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/checkins", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;
    const today = todayStr();

    const conditions: any[] = [eq(bookingsTable.checkIn, today)];
    if (effectiveHotelId) conditions.push(eq(bookingsTable.hotelId, effectiveHotelId));

    const bookings = await db.select().from(bookingsTable).where(and(...conditions));
    res.json(bookings.map((b) => ({
      ...b,
      roomRent: parseFloat(b.roomRent),
      addOns: parseFloat(b.addOns),
      totalCost: parseFloat(b.totalCost),
      receipt: parseFloat(b.receipt),
      balance: parseFloat(b.balance),
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/checkouts", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;
    const today = todayStr();

    const conditions: any[] = [eq(bookingsTable.checkOut, today)];
    if (effectiveHotelId) conditions.push(eq(bookingsTable.hotelId, effectiveHotelId));

    const bookings = await db.select().from(bookingsTable).where(and(...conditions));
    res.json(bookings.map((b) => ({
      ...b,
      roomRent: parseFloat(b.roomRent),
      addOns: parseFloat(b.addOns),
      totalCost: parseFloat(b.totalCost),
      receipt: parseFloat(b.receipt),
      balance: parseFloat(b.balance),
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
