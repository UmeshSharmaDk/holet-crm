import { Router } from "express";
import { db, agenciesTable, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireOwnerOrAdmin } from "../middlewares/auth.js";
import { requireHotelScope, hotelFilter, denyOutOfScope, type HotelScope } from "../lib/scope.js";
import {
  parseIdParam,
  parseOptionalId,
  text,
  optionalText,
  optionalEmail,
  handleValidationError,
} from "../lib/validate.js";

const router = Router();

router.get("/", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const filter = hotelFilter(req.hotelScope as HotelScope, agenciesTable.hotelId);
    const agencies = filter
      ? await db.select().from(agenciesTable).where(filter).orderBy(agenciesTable.name)
      : await db.select().from(agenciesTable).orderBy(agenciesTable.name);
    res.json(agencies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const scope = req.hotelScope as HotelScope;
    const requestedHotelId = parseOptionalId(req.body?.hotelId);
    const targetHotelId = scope.kind === "hotel" ? scope.hotelId : requestedHotelId ?? null;
    if (!targetHotelId) {
      res.status(400).json({ error: "Bad Request", message: "name and hotelId are required" });
      return;
    }
    if (scope.kind === "hotel" && requestedHotelId != null && requestedHotelId !== scope.hotelId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot create an agency for another hotel" });
      return;
    }

    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, targetHotelId));
    if (!hotel) {
      res.status(400).json({ error: "Bad Request", message: "hotelId does not exist" });
      return;
    }

    const [agency] = await db
      .insert(agenciesTable)
      .values({
        name: text(req.body?.name, "name", 200),
        contactEmail: optionalEmail(req.body?.contactEmail, "contactEmail"),
        contactPhone: optionalText(req.body?.contactPhone, "contactPhone", 40),
        hotelId: targetHotelId,
      })
      .returning();
    res.status(201).json(agency);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const agencyId = parseIdParam(res, req.params.id);
    if (agencyId === null) return;

    const [agency] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, agencyId));
    if (!agency) { res.status(404).json({ error: "Not Found" }); return; }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, agency.hotelId)) return;

    res.json(agency);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireAuth, requireHotelScope, async (req, res) => {
  try {
    const agencyId = parseIdParam(res, req.params.id);
    if (agencyId === null) return;

    const [existing] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, agencyId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, existing.hotelId)) return;

    const body = req.body ?? {};
    // Only overwrite fields the caller actually sent: coercing an absent key to
    // null used to wipe stored contact details on a partial update.
    const [agency] = await db
      .update(agenciesTable)
      .set({
        name: body.name !== undefined ? text(body.name, "name", 200) : existing.name,
        contactEmail: body.contactEmail !== undefined
          ? optionalEmail(body.contactEmail, "contactEmail")
          : existing.contactEmail,
        contactPhone: body.contactPhone !== undefined
          ? optionalText(body.contactPhone, "contactPhone", 40)
          : existing.contactPhone,
      })
      .where(eq(agenciesTable.id, agencyId))
      .returning();

    res.json(agency);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Destructive: deleting an agency detaches every booking attributed to it
// (bookings.agencyId is ON DELETE SET NULL), so it follows the same
// owner-or-admin rule as deleting a booking.
router.delete("/:id", requireAuth, requireOwnerOrAdmin, requireHotelScope, async (req, res) => {
  try {
    const agencyId = parseIdParam(res, req.params.id);
    if (agencyId === null) return;

    const [existing] = await db.select().from(agenciesTable).where(eq(agenciesTable.id, agencyId));
    if (!existing) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    if (denyOutOfScope(res, req.hotelScope as HotelScope, existing.hotelId)) return;

    await db.delete(agenciesTable).where(eq(agenciesTable.id, agencyId));
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
