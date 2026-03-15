import { Router } from "express";
import { db, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const hotels = await db.select().from(hotelsTable).orderBy(hotelsTable.name);
    res.json(hotels);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, parseInt(req.params.id)));
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
    const { name, totalRooms } = req.body;
    if (!name || totalRooms === undefined) {
      res.status(400).json({ error: "Bad Request", message: "name and totalRooms are required" });
      return;
    }
    const [hotel] = await db.insert(hotelsTable).values({ name, totalRooms }).returning();
    res.status(201).json(hotel);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, totalRooms } = req.body;
    const [hotel] = await db
      .update(hotelsTable)
      .set({ name, totalRooms })
      .where(eq(hotelsTable.id, parseInt(req.params.id)))
      .returning();
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

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.delete(hotelsTable).where(eq(hotelsTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
