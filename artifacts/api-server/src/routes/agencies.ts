import { Router } from "express";
import { db, agenciesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { hotelId: queryHotelId } = req.query;
    const effectiveHotelId = req.user?.role === "admin"
      ? queryHotelId ? parseInt(queryHotelId as string) : undefined
      : req.user?.hotelId ?? undefined;

    let agencies;
    if (effectiveHotelId) {
      agencies = await db.select().from(agenciesTable).where(eq(agenciesTable.hotelId, effectiveHotelId)).orderBy(agenciesTable.name);
    } else if (req.user?.role === "admin") {
      agencies = await db.select().from(agenciesTable).orderBy(agenciesTable.name);
    } else {
      res.json([]);
      return;
    }
    res.json(agencies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, contactEmail, contactPhone, hotelId } = req.body;
    const targetHotelId = req.user?.role === "admin" ? hotelId : req.user?.hotelId;
    if (!name || !targetHotelId) {
      res.status(400).json({ error: "Bad Request", message: "name and hotelId are required" });
      return;
    }
    const [agency] = await db
      .insert(agenciesTable)
      .values({ name, contactEmail: contactEmail ?? null, contactPhone: contactPhone ?? null, hotelId: targetHotelId })
      .returning();
    res.status(201).json(agency);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [agency] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, parseInt(req.params.id)));
    if (!agency) { res.status(404).json({ error: "Not Found" }); return; }
    res.json(agency);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { name, contactEmail, contactPhone } = req.body;
    const [agency] = await db
      .update(agenciesTable)
      .set({ name, contactEmail: contactEmail ?? null, contactPhone: contactPhone ?? null })
      .where(eq(agenciesTable.id, parseInt(req.params.id)))
      .returning();
    if (!agency) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(agency);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await db.delete(agenciesTable).where(eq(agenciesTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
