import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { hotelsTable } from "./hotels";

export const userRoleEnum = pgEnum("user_role", ["admin", "owner", "manager"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("manager"),
  hotelId: integer("hotel_id").references(() => hotelsTable.id, { onDelete: "set null" }),
  // Bumped whenever credentials change so already-issued JWTs stop verifying.
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, tokenVersion: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
