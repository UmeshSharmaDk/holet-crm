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

    let totalRooms = 0;
    if (effectiveHotelId) {
      const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, effectiveHotelId));
      totalRooms = hotel?.totalRooms ?? 0;
    } else {
      const [r] = await db.select({ total: sql<number>`sum(${hotelsTable.totalRooms})` }).from(hotelsTable);
      totalRooms = Number(r?.total ?? 0);
    }

    const daysInMonth = new Date(y, m, 0).getDate();
    const dailyOccupancy = [];
    let totalOccupied = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const conditions: any[] = [
        sql`${bookingsTable.checkIn} <= ${dateStr}`,
        sql`${bookingsTable.checkOut} > ${dateStr}`,
        sql`${bookingsTable.status} IN ('confirmed', 'checked_in')`,
      ];
      if (effectiveHotelId) conditions.push(eq(bookingsTable.hotelId, effectiveHotelId));

      const [result] = await db
        .select({ total: sql<number>`coalesce(sum(${bookingsTable.numberOfRooms}), 0)` })
        .from(bookingsTable)
        .where(and(...conditions));
      const occupied = Number(result?.total ?? 0);
      totalOccupied += occupied;
      const percentage = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;
      dailyOccupancy.push({ date: dateStr, occupiedRooms: occupied, totalRooms, percentage });
    }

    res.json({
      dailyOccupancy,
      averageOccupancy: daysInMonth > 0 ? Math.round(totalOccupied / daysInMonth) : 0,
      totalRooms,
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
