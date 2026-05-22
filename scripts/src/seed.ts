import { db, hotelsTable, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding database...");


  const adminHash = await bcrypt.hash("Umeshdk@123..", 12);

  await db.insert(usersTable).values([
    { email: "admin@outhillsmanali.com", name: "System Admin", passwordHash: adminHash, role: "admin", hotelId: null },
  ]).onConflictDoNothing();
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
