import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(usersTable.name);

    const usersWithHotels = await Promise.all(
      users.map(async (u) => {
        let hotel = null;
        if (u.hotelId) {
          const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, u.hotelId));
          hotel = h ?? null;
        }
        return { ...u, hotel };
      })
    );

    res.json(usersWithHotels);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, password, role, hotelId } = req.body;
    if (!email || !name || !password || !role) {
      res.status(400).json({ error: "Bad Request", message: "email, name, password, and role are required" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ email: email.toLowerCase(), name, passwordHash, role, hotelId: hotelId ?? null })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        createdAt: usersTable.createdAt,
      });

    let hotel = null;
    if (user.hotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, user.hotelId));
      hotel = h ?? null;
    }

    res.status(201).json({ ...user, hotel });
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Conflict", message: "Email already in use" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, role, hotelId, password } = req.body;
    const updateData: any = {};
    if (email) updateData.email = email.toLowerCase();
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (hotelId !== undefined) updateData.hotelId = hotelId;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const [user] = await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, parseInt(req.params.id)))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        createdAt: usersTable.createdAt,
      });

    if (!user) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    let hotel = null;
    if (user.hotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, user.hotelId));
      hotel = h ?? null;
    }

    res.json({ ...user, hotel });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.delete(usersTable).where(eq(usersTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
