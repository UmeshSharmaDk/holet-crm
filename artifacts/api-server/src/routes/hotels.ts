import { Router } from "express";
import { db, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const hotelId = parseIdParam(res, req.params.id);
    if (hotelId === null) return;

    const [existing] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    await db.delete(hotelsTable).where(eq(hotelsTable.id, hotelId));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
