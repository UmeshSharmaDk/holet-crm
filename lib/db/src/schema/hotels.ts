import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hotelsTable = pgTable("hotels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  totalRooms: integer("total_rooms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHotelSchema = createInsertSchema(hotelsTable).omit({ id: true, createdAt: true });
export type InsertHotel = z.infer<typeof insertHotelSchema>;
export type Hotel = typeof hotelsTable.$inferSelect;
