import { db, hotelsTable, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";

/**
 * Seeds the initial administrator.
 *
 * Credentials come from the environment. A password committed here would be
 * readable by anyone with repository access — including in history, long after
 * the line was removed — and this account has unrestricted access to every
 * hotel, user and guest record on the platform.
 */
async function seed() {
  const email = process.env["SEED_ADMIN_EMAIL"];
  const password = process.env["SEED_ADMIN_PASSWORD"];
  const name = process.env["SEED_ADMIN_NAME"] ?? "System Admin";

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set. " +
        "Refusing to seed an administrator with a default password.",
    );
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
  }

  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(usersTable).values([
    { email: email.toLowerCase(), name, passwordHash, role: "admin", hotelId: null },
  ]).onConflictDoNothing();

  console.log(`Seeded admin ${email.toLowerCase()} (no-op if it already existed).`);
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
