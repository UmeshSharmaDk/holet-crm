import { db, hotelsTable, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding database...");

  const [hotel] = await db
    .insert(hotelsTable)
    .values({ name: "Grand Palace Hotel", totalRooms: 50 })
    .onConflictDoNothing()
    .returning();

  if (hotel) {
    const adminHash = await bcrypt.hash("admin123", 12);
    const ownerHash = await bcrypt.hash("owner123", 12);
    const managerHash = await bcrypt.hash("manager123", 12);

    await db.insert(usersTable).values([
      { email: "admin@hotel.com", name: "System Admin", passwordHash: adminHash, role: "admin", hotelId: null },
      { email: "owner@hotel.com", name: "Hotel Owner", passwordHash: ownerHash, role: "owner", hotelId: hotel.id },
      { email: "manager@hotel.com", name: "Hotel Manager", passwordHash: managerHash, role: "manager", hotelId: hotel.id },
    ]).onConflictDoNothing();

    console.log(`Created hotel: ${hotel.name} (ID: ${hotel.id})`);
    console.log("Created users:");
    console.log("  admin@hotel.com / admin123 (Admin)");
    console.log("  owner@hotel.com / owner123 (Owner, Hotel ID: " + hotel.id + ")");
    console.log("  manager@hotel.com / manager123 (Manager, Hotel ID: " + hotel.id + ")");
  } else {
    console.log("Hotel already exists, skipping seed.");
  }
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
