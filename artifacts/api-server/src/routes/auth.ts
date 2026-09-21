import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, hotelsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middlewares/auth.js";
import { recordAudit } from "../lib/audit.js";
import { createPasswordResetToken, consumePasswordResetToken } from "../lib/passwordReset.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { password, handleValidationError } from "../lib/validate.js";
import { setAuthCookies, clearAuthCookies } from "../lib/authCookies.js";

const router = Router();

const PASSWORD_RESET_TOKEN_TTL_MINUTES = Number(process.env["PASSWORD_RESET_TOKEN_TTL_MINUTES"] ?? 60);
const PASSWORD_RESET_URL_BASE = process.env["PASSWORD_RESET_URL_BASE"] ?? "https://crm.outhillsmanali.com";

/**
 * A real bcrypt hash compared against when the email is unknown.
 *
 * Returning early for an unknown email made login measurably faster for
 * addresses that do not exist, which is enough to enumerate valid accounts
 * before mounting a password attack. Both paths now pay the same cost.
 */
const DUMMY_HASH = bcrypt.hashSync("holet-crm-invalid-credentials-placeholder", 12);

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
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
        tokenVersion: usersTable.tokenVersion,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase()));

    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId,
      tokenVersion: user.tokenVersion,
    });

    let hotel = null;
    if (user.hotelId) {
      const [h] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, user.hotelId));
      hotel = h ?? null;
    }

    const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = user;

    // Native reads `token` from this body and holds it in the Keychain.
    // The web client ignores it and relies on the cookie instead — nothing
    // in the response is capable of putting the token where JS can read it.
    setAuthCookies(res, token);
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

/**
 * Clears the web session cookies. JS cannot delete an httpOnly cookie
 * itself, so ending a cookie-based session needs a server round trip; a
 * native client has nothing to clear here and this is a harmless no-op for
 * it. Unauthenticated on purpose — logging out of a session that is already
 * gone, or that was never a cookie session, must not itself require one.
 */
router.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.status(204).send();
});

/**
 * Requests a password reset link by email.
 *
 * Always answers the same way regardless of whether the address exists —
 * otherwise this becomes the account-enumeration oracle that DUMMY_HASH
 * closed on /login. Rate-limited in app.ts, same as login.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.email !== "string" || !body.email.trim()) {
      res.status(400).json({ error: "Bad Request", message: "email is required" });
      return;
    }
    const normalizedEmail = body.email.trim().toLowerCase();

    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));

    if (user) {
      const rawToken = await createPasswordResetToken(user.id);
      const resetUrl = `${PASSWORD_RESET_URL_BASE}/reset-password?token=${rawToken}`;
      // Fire-and-forget, same convention as the booking-update notification:
      // the response must not wait on — or vary in timing with — an SMTP
      // round trip that only happens on this branch.
      sendPasswordResetEmail(user.email, resetUrl, PASSWORD_RESET_TOKEN_TTL_MINUTES).catch(console.error);
    }

    res.json({ message: "If an account exists for that email, a password reset link has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Completes a password reset using the token from the emailed link.
 *
 * The new password is validated before the token is consumed, so a request
 * with a bad password does not burn an otherwise-valid token.
 */
router.post("/reset-password", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.token !== "string" || !body.token) {
      res.status(400).json({ error: "Bad Request", message: "token is required" });
      return;
    }
    const newPasswordValue = password(body.newPassword, "newPassword");

    const userId = await consumePasswordResetToken(body.token);
    if (userId === null) {
      res.status(400).json({ error: "Bad Request", message: "Invalid or expired reset token" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      // Account was deleted between the token being issued and used.
      res.status(400).json({ error: "Bad Request", message: "Invalid or expired reset token" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPasswordValue, 12);
    await db
      .update(usersTable)
      .set({ passwordHash, tokenVersion: sql`${usersTable.tokenVersion} + 1` })
      .where(eq(usersTable.id, user.id));

    await recordAudit(
      req,
      {
        action: "user.password_change",
        targetType: "user",
        targetId: user.id,
        hotelId: user.hotelId,
        detail: { email: user.email, sessionsInvalidated: true, method: "self_service_reset" },
      },
      { userId: user.id, email: user.email, role: user.role },
    );

    res.json({ message: "Password has been reset. Please log in with your new password." });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Self-service password change for an authenticated user.
 *
 * Bumping tokenVersion invalidates every outstanding token, including the
 * one the caller just used to authenticate this request — so a fresh token
 * is returned, otherwise this endpoint would immediately log its own caller
 * out.
 */
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.currentPassword !== "string" || !body.currentPassword) {
      res.status(400).json({ error: "Bad Request", message: "currentPassword is required" });
      return;
    }
    const newPasswordValue = password(body.newPassword, "newPassword");

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));
    if (!user) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Unauthorized", message: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPasswordValue, 12);
    const nextTokenVersion = user.tokenVersion + 1;
    await db
      .update(usersTable)
      .set({ passwordHash, tokenVersion: nextTokenVersion })
      .where(eq(usersTable.id, user.id));

    await recordAudit(req, {
      action: "user.password_change",
      targetType: "user",
      targetId: user.id,
      hotelId: user.hotelId,
      detail: { email: user.email, sessionsInvalidated: true, method: "self_service_change" },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      hotelId: user.hotelId,
      tokenVersion: nextTokenVersion,
    });

    // A cookie session's old token just became invalid along with every
    // other one — refresh the cookie itself, or this request would log its
    // own browser session out. A Bearer caller gets the same continuity via
    // the token in the body instead.
    if (req.authSource === "cookie") {
      setAuthCookies(res, token);
    }

    res.json({ message: "Password changed successfully.", token });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
