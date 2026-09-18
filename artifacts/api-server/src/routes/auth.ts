import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, tokenExpiry } from "../lib/jwt.js";
import { requireAuth } from "../middlewares/auth.js";
import {
  SESSION_COOKIE,
  clearSessionCookies,
  csrfHeaderMatchesCookie,
  issueSessionCookies,
  readCookie,
  wantsCookieSession,
} from "../lib/cookies.js";

const router = Router();

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
    const profile = { ...userWithoutPassword, hotel };

    /**
     * The web client asks for cookie transport, and then the token is never
     * put in the response body at all — there is no JS-reachable copy for an
     * injected script to steal, and none to persist in localStorage. Native
     * clients say nothing and keep getting a Bearer token, which they hold in
     * the Keychain/Keystore where a cookie would not help them.
     */
    if (wantsCookieSession(req)) {
      issueSessionCookies(res, token, user.id, tokenExpiry(token));
      res.json({ user: profile });
      return;
    }

    res.json({ token, user: profile });
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
 * Ends a cookie session.
 *
 * Only the server can clear an httpOnly cookie, so logging out has to be a
 * request rather than something the client does locally. It deliberately does
 * not require a valid token: a session whose token has expired or been revoked
 * is exactly the one a user most needs to be able to clear.
 *
 * The CSRF check still applies where a session cookie is present, so another
 * site cannot log a user out from under them. Bearer clients have no cookie to
 * clear and get a successful no-op.
 */
router.post("/logout", (req, res) => {
  if (readCookie(req, SESSION_COOKIE) && !csrfHeaderMatchesCookie(req)) {
    res.status(403).json({ error: "Forbidden", message: "Missing or invalid CSRF token" });
    return;
  }

  clearSessionCookies(res);
  res.status(204).end();
});

export default router;
