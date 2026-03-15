import { pgTable, serial, text, integer, timestamp, date, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hotelsTable } from "./hotels";
import { agenciesTable } from "./agencies";

export const bookingStatusEnum = pgEnum("booking_status", ["confirmed", "checked_in", "checked_out", "cancelled"]);

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  roomNumber: text("room_number"),
  roomType: text("room_type"),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  roomRent: numeric("room_rent", { precision: 10, scale: 2 }).notNull().default("0"),
  addOns: numeric("add_ons", { precision: 10, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  receipt: numeric("receipt", { precision: 10, scale: 2 }).notNull().default("0"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  status: bookingStatusEnum("status").notNull().default("confirmed"),
  hotelId: integer("hotel_id").notNull().references(() => hotelsTable.id, { onDelete: "cascade" }),
  agencyId: integer("agency_id").references(() => agenciesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true, totalCost: true, balance: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
