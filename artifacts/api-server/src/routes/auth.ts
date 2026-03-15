import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Bad Request", message: "Email and password are required" });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        passwordHash: usersTable.passwordHash,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()));

    if (!user) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId,
    });

    let hotel = null;
    if (user.hotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, user.hotelId));
      hotel = h ?? null;
    }

    const { passwordHash: _, ...userWithoutPassword } = user;

    res.json({ token, user: { ...userWithoutPassword, hotel } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        hotelId: usersTable.hotelId,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId));

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
    console.error("Get me error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
