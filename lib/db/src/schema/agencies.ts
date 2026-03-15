import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hotelsTable } from "./hotels";

export const agenciesTable = pgTable("agencies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  hotelId: integer("hotel_id").notNull().references(() => hotelsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgencySchema = createInsertSchema(agenciesTable).omit({ id: true, createdAt: true });
export type InsertAgency = z.infer<typeof insertAgencySchema>;
export type Agency = typeof agenciesTable.$inferSelect;
