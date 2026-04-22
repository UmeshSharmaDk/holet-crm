import { Router } from "express";
import { db, bookingsTable, hotelsTable, agenciesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/occupancy", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId, month, year } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;

    const now = new Date();
    const m = month ? parseInt(month as string) : now.getMonth() + 1;
    const y = year ? parseInt(year as string) : now.getFullYear();

    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDay = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextMonth = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    let totalRooms = 0;
    if (effectiveHotelId) {
      const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, effectiveHotelId));
      totalRooms = hotel?.totalRooms ?? 0;
    } else {
      const [r] = await db.select({ total: sql<number>`coalesce(sum(${hotelsTable.totalRooms}), 0)` }).from(hotelsTable);
      totalRooms = Number(r?.total ?? 0);
    }

    const conditions: any[] = [
      sql`${bookingsTable.checkIn} < ${nextMonth}`,
      sql`${bookingsTable.checkOut} > ${firstDay}`,
      sql`${bookingsTable.status} IN ('confirmed', 'checked_in')`,
    ];
    if (effectiveHotelId) conditions.push(eq(bookingsTable.hotelId, effectiveHotelId));

    const [aggregate] = await db
      .select({
        roomNights: sql<number>`coalesce(sum(
          ${bookingsTable.numberOfRooms} *
          (LEAST(cast(${bookingsTable.checkOut} as date), cast(${nextMonth} as date)) -
           GREATEST(cast(${bookingsTable.checkIn} as date), cast(${firstDay} as date)))
        ), 0)`,
        bookingsCount: sql<number>`count(*)`,
        totalRoomsBooked: sql<number>`coalesce(sum(${bookingsTable.numberOfRooms}), 0)`,
        totalPersons: sql<number>`coalesce(sum(${bookingsTable.numberOfPersons}), 0)`,
      })
      .from(bookingsTable)
      .where(and(...conditions));

    const roomNights = Number(aggregate?.roomNights ?? 0);
    const capacity = totalRooms * daysInMonth;
    const averageOccupiedRooms = daysInMonth > 0 ? roomNights / daysInMonth : 0;
    const occupancyPercentage = capacity > 0 ? Math.round((roomNights / capacity) * 100) : 0;

    res.json({
      month: m,
      year: y,
      daysInMonth,
      totalRooms,
      roomNights,
      averageOccupiedRooms: Math.round(averageOccupiedRooms * 10) / 10,
      occupancyPercentage,
      bookingsCount: Number(aggregate?.bookingsCount ?? 0),
      totalRoomsBooked: Number(aggregate?.totalRoomsBooked ?? 0),
      totalPersons: Number(aggregate?.totalPersons ?? 0),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/revenue", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId, year } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;

    const y = year ? parseInt(year as string) : new Date().getFullYear();

    const hotelCondition = effectiveHotelId ? eq(bookingsTable.hotelId, effectiveHotelId) : sql`1=1`;

    const monthlyData = await db
      .select({
        month: sql<number>`extract(month from cast(${bookingsTable.checkIn} as date))`,
        year: sql<number>`extract(year from cast(${bookingsTable.checkIn} as date))`,
        revenue: sql<number>`sum(cast(${bookingsTable.totalCost} as decimal))`,
        bookings: sql<number>`count(*)`,
      })
      .from(bookingsTable)
      .where(and(
        hotelCondition as any,
        sql`extract(year from cast(${bookingsTable.checkIn} as date)) = ${y}`
      ))
      .groupBy(
        sql`extract(month from cast(${bookingsTable.checkIn} as date))`,
        sql`extract(year from cast(${bookingsTable.checkIn} as date))`
      )
      .orderBy(sql`extract(month from cast(${bookingsTable.checkIn} as date))`);

    const agencies = await db.select().from(agenciesTable);
    const agencyRevenue = await db
      .select({
        agencyId: bookingsTable.agencyId,
        revenue: sql<number>`sum(cast(${bookingsTable.totalCost} as decimal))`,
        bookings: sql<number>`count(*)`,
      })
      .from(bookingsTable)
      .where(and(
        hotelCondition as any,
        sql`extract(year from cast(${bookingsTable.checkIn} as date)) = ${y}`
      ))
      .groupBy(bookingsTable.agencyId);

    const agencyRevenueWithNames = agencyRevenue.map((ar) => {
      const agency = agencies.find((a) => a.id === ar.agencyId);
      return {
        agencyId: ar.agencyId,
        agencyName: agency?.name ?? "Direct / Walk-in",
        revenue: Number(ar.revenue ?? 0),
        bookings: Number(ar.bookings ?? 0),
      };
    });

    const [totalResult] = await db
      .select({ total: sql<number>`sum(cast(${bookingsTable.totalCost} as decimal))` })
      .from(bookingsTable)
      .where(and(
        hotelCondition as any,
        sql`extract(year from cast(${bookingsTable.checkIn} as date)) = ${y}`
      ));

    res.json({
      monthlyRevenue: monthlyData.map((m) => ({
        month: Number(m.month),
        year: Number(m.year),
        revenue: Number(m.revenue ?? 0),
        bookings: Number(m.bookings ?? 0),
      })),
      agencyRevenue: agencyRevenueWithNames,
      totalYearlyRevenue: Number(totalResult?.total ?? 0),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
