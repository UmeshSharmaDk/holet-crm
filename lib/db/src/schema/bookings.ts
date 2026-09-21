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
  numberOfRooms: integer("number_of_rooms").notNull().default(1),
  numberOfPersons: integer("number_of_persons").notNull().default(1),
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

export const bookingGuestsTable = pgTable("booking_guests", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  personIndex: integer("person_index").notNull(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth"),
  relation: text("relation").notNull(),
  // The bytes live encrypted on disk (lib/idFileStore.ts), not in Postgres —
  // this row keeps only enough to find, verify and serve them: an opaque
  // key, never a path or anything derived from the guest's own name.
  frontIdKey: text("front_id_key"),
  frontIdMimeType: text("front_id_mime_type"),
  frontIdName: text("front_id_name"),
  frontIdChecksum: text("front_id_checksum"),
  frontIdSize: integer("front_id_size"),
  backIdKey: text("back_id_key"),
  backIdMimeType: text("back_id_mime_type"),
  backIdName: text("back_id_name"),
  backIdChecksum: text("back_id_checksum"),
  backIdSize: integer("back_id_size"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true, totalCost: true, balance: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
export type BookingGuest = typeof bookingGuestsTable.$inferSelect;
