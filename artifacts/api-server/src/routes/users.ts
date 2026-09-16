import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, hotelsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { recordAudit } from "../lib/audit.js";
import {
  parseIdParam,
  parseOptionalId,
  text,
  email as validEmail,
  oneOf,
  USER_ROLES,
  ValidationError,
  handleValidationError,
} from "../lib/validate.js";

const router = Router();

const MIN_PASSWORD_LENGTH = 10;

function password(raw: unknown): string {
  const value = String(raw ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (value.length > 200) {
    throw new ValidationError("password must be at most 200 characters");
  }
  return value;
}

// Users joined to their hotel in one query rather than one lookup per user.
function userQuery() {
  return db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      hotelId: usersTable.hotelId,
      createdAt: usersTable.createdAt,
      hotel: hotelsTable,
    })
    .from(usersTable)
    .leftJoin(hotelsTable, eq(usersTable.hotelId, hotelsTable.id));
}

async function assertHotelExists(hotelId: number | null) {
  if (hotelId == null) return;
  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId));
  if (!hotel) throw new ValidationError("hotelId does not exist");
}

router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await userQuery().orderBy(usersTable.name);
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const role = oneOf(body.role, "role", USER_ROLES);
    const hotelId = parseOptionalId(body.hotelId) ?? null;

    // A non-admin without a hotel can see nothing, so reject the combination
    // at creation time rather than producing a dead account.
    if (role !== "admin" && hotelId == null) {
      throw new ValidationError("hotelId is required for owner and manager accounts");
    }
    await assertHotelExists(hotelId);

    const passwordHash = await bcrypt.hash(password(body.password), 12);
    const [created] = await db
      .insert(usersTable)
      .values({
        email: validEmail(body.email),
        name: text(body.name, "name", 200),
        passwordHash,
        role,
        hotelId,
      })
      .returning({ id: usersTable.id });

    const [user] = await userQuery().where(eq(usersTable.id, created.id));
    res.status(201).json(user);
  } catch (error: any) {
    if (handleValidationError(res, error)) return;
    if (error?.code === "23505") {
      res.status(409).json({ error: "Conflict", message: "Email already in use" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIdParam(res, req.params.id);
    if (userId === null) return;

    const [user] = await userQuery().where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "Not Found" }); return; }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIdParam(res, req.params.id);
    if (userId === null) return;

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const body = req.body ?? {};
    const updateData: Record<string, unknown> = {};
    if (body.email !== undefined) updateData.email = validEmail(body.email);
    if (body.name !== undefined) updateData.name = text(body.name, "name", 200);
    if (body.role !== undefined) updateData.role = oneOf(body.role, "role", USER_ROLES);
    if (body.hotelId !== undefined) {
      const hotelId = parseOptionalId(body.hotelId) ?? null;
      await assertHotelExists(hotelId);
      updateData.hotelId = hotelId;
    }

    const nextRole = (updateData.role as string | undefined) ?? existing.role;
    const nextHotelId = body.hotelId !== undefined ? (updateData.hotelId as number | null) : existing.hotelId;
    if (nextRole !== "admin" && nextHotelId == null) {
      throw new ValidationError("hotelId is required for owner and manager accounts");
    }

    // Changing a password invalidates every token issued before the change.
    if (body.password !== undefined) {
      updateData.passwordHash = await bcrypt.hash(password(body.password), 12);
      updateData.tokenVersion = sql`${usersTable.tokenVersion} + 1`;
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(usersTable).set(updateData).where(eq(usersTable.id, userId));
    }

    // Recorded separately: a role change and a credential reset are different
    // questions after an incident, and both matter.
    if (updateData.role !== undefined && updateData.role !== existing.role) {
      await recordAudit(req, {
        action: "user.role_change",
        targetType: "user",
        targetId: userId,
        hotelId: (updateData.hotelId as number | null | undefined) ?? existing.hotelId,
        detail: { from: existing.role, to: updateData.role, email: existing.email },
      });
    }
    if (body.password !== undefined) {
      await recordAudit(req, {
        action: "user.password_change",
        targetType: "user",
        targetId: userId,
        hotelId: existing.hotelId,
        // The password itself is never recorded — only that it was reset.
        detail: { email: existing.email, sessionsInvalidated: true },
      });
    }

    const [user] = await userQuery().where(eq(usersTable.id, userId));
    res.json(user);
  } catch (error: any) {
    if (handleValidationError(res, error)) return;
    if (error?.code === "23505") {
      res.status(409).json({ error: "Conflict", message: "Email already in use" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIdParam(res, req.params.id);
    if (userId === null) return;

    // Deleting your own account would lock you out of the admin surface.
    if (userId === req.user!.userId) {
      res.status(400).json({ error: "Bad Request", message: "You cannot delete your own account" });
      return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await recordAudit(req, {
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      hotelId: existing.hotelId,
      detail: { email: existing.email, role: existing.role },
    });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
