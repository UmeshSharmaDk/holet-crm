import { Router } from "express";
import { db, hotelsTable, bookingsTable, agenciesTable, bookingGuestsTable } from "@workspace/db";
import { eq, and, count as sqlCount, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { parseIdParam, text, count, handleValidationError } from "../lib/validate.js";

const router = Router();

// Non-admins only ever see the hotel they are assigned to; the full estate
// (names and room counts of every tenant) is admin-only.
router.get("/", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    if (user.role !== "admin") {
      if (user.hotelId == null) {
        res.json([]);
        return;
      }
      const hotels = await db.select().from(hotelsTable).where(eq(hotelsTable.id, user.hotelId));
      res.json(hotels);
      return;
    }
    const hotels = await db.select().from(hotelsTable).orderBy(hotelsTable.name);
    res.json(hotels);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const hotelId = parseIdParam(res, req.params.id);
    if (hotelId === null) return;

    const user = req.user!;
    if (user.role !== "admin" && user.hotelId !== hotelId) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId));
    if (!hotel) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(hotel);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [hotel] = await db.insert(hotelsTable).values({
      name: text(req.body?.name, "name", 200),
      totalRooms: count(req.body?.totalRooms, "totalRooms", 0),
    }).returning();
    res.status(201).json(hotel);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const hotelId = parseIdParam(res, req.params.id);
    if (hotelId === null) return;

    const [existing] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const body = req.body ?? {};
    const [hotel] = await db
      .update(hotelsTable)
      .set({
        name: body.name !== undefined ? text(body.name, "name", 200) : existing.name,
        totalRooms: body.totalRooms !== undefined ? count(body.totalRooms, "totalRooms", existing.totalRooms) : existing.totalRooms,
      })
      .where(eq(hotelsTable.id, hotelId))
      .returning();
    res.json(hotel);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Everything a hotel deletion would take with it.
 *
 * bookings and agencies cascade from hotels, and booking_guests cascades from
 * bookings, so one request removes the hotel's entire history including every
 * stored identity document. Counting first is what lets the caller be told
 * precisely what they are about to destroy.
 */
async function deletionImpact(hotelId: number) {
  const [bookingRow] = await db
    .select({ total: sqlCount() })
    .from(bookingsTable)
    .where(eq(bookingsTable.hotelId, hotelId));

  const [agencyRow] = await db
    .select({ total: sqlCount() })
    .from(agenciesTable)
    .where(eq(agenciesTable.hotelId, hotelId));

  const [scanRow] = await db
    .select({ total: sqlCount() })
    .from(bookingGuestsTable)
    .innerJoin(bookingsTable, eq(bookingGuestsTable.bookingId, bookingsTable.id))
    .where(and(
      eq(bookingsTable.hotelId, hotelId),
      sql`(${bookingGuestsTable.frontIdData} IS NOT NULL OR ${bookingGuestsTable.backIdData} IS NOT NULL)`,
    ));

  return {
    bookings: Number(bookingRow?.total ?? 0),
    agencies: Number(agencyRow?.total ?? 0),
    guestIdScans: Number(scanRow?.total ?? 0),
  };
}

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const hotelId = parseIdParam(res, req.params.id);
    if (hotelId === null) return;

    const [existing] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const impact = await deletionImpact(hotelId);
    const destroysData = impact.bookings > 0 || impact.agencies > 0;

    /**
     * A hotel with history cannot be removed by a bare request. Naming it back
     * is deliberately more effort than clicking a button: a mistyped id in the
     * admin UI would otherwise be unrecoverable without a database restore, and
     * the records include guests' identity documents.
     */
    if (destroysData && req.body?.confirm !== existing.name) {
      res.status(409).json({
        error: "Conflict",
        message:
          `Deleting "${existing.name}" would permanently remove ${impact.bookings} booking(s), ` +
          `${impact.agencies} agency record(s) and ${impact.guestIdScans} stored guest ID scan(s). ` +
          `This cannot be undone. Send { "confirm": "${existing.name}" } to proceed.`,
        confirmationRequired: true,
        impact,
      });
      return;
    }

    await db.delete(hotelsTable).where(eq(hotelsTable.id, hotelId));
    console.log(
      `[hotels] user ${req.user!.userId} deleted hotel ${hotelId} ("${existing.name}") ` +
      `removing ${impact.bookings} booking(s), ${impact.agencies} agency record(s), ${impact.guestIdScans} ID scan(s)`,
    );
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
