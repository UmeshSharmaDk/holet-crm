import "./env.js";

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, hotelsTable, usersTable, agenciesTable, bookingsTable } from "@workspace/db";
import app from "../../app.js";

export const PASSWORD = "TestPassword123!";

let server: Server | null = null;
let baseUrl = "";

export async function startServer(): Promise<string> {
  if (server) return baseUrl;
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((err) => (err ? reject(err) : resolve())),
  );
  server = null;
}

/**
 * Wipes every table and restarts the id sequences so fixture ids are stable.
 *
 * rate_limits is included deliberately. Since those counters moved into the
 * database they outlive the process — which is the entire point — so without
 * this a suite inherits the budget the previous one spent and starts seeing
 * 429s that have nothing to do with what it is testing.
 */
export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE booking_guests, bookings, agencies, users, hotels RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`TRUNCATE TABLE rate_limits`);
  await db.execute(sql`TRUNCATE TABLE audit_log RESTART IDENTITY`);
}

export interface Fixtures {
  hotelA: number;
  hotelB: number;
  agencyA: number;
  agencyB: number;
  bookingA: number;
  bookingB: number;
}

/**
 * Two hotels that must never see each other, plus the account shapes that the
 * authorization rules turn on — including a non-admin with no hotel, which is
 * the case that used to fail open and return every tenant's data.
 */
export async function seedFixtures(): Promise<Fixtures> {
  await resetDatabase();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const [hotelA] = await db.insert(hotelsTable).values({ name: "Hotel A", totalRooms: 10 }).returning();
  const [hotelB] = await db.insert(hotelsTable).values({ name: "Hotel B", totalRooms: 20 }).returning();

  await db.insert(usersTable).values([
    { email: "admin@test.local", name: "Admin", passwordHash, role: "admin", hotelId: null },
    { email: "ownera@test.local", name: "Owner A", passwordHash, role: "owner", hotelId: hotelA!.id },
    { email: "managera@test.local", name: "Manager A", passwordHash, role: "manager", hotelId: hotelA!.id },
    { email: "ownerb@test.local", name: "Owner B", passwordHash, role: "owner", hotelId: hotelB!.id },
    { email: "managerb@test.local", name: "Manager B", passwordHash, role: "manager", hotelId: hotelB!.id },
    // Inserted directly: the API refuses to create this shape now, but rows
    // like it exist from before that rule and must still fail closed.
    { email: "orphan@test.local", name: "Orphan", passwordHash, role: "manager", hotelId: null },
  ]);

  const [agencyA] = await db.insert(agenciesTable).values({
    name: "Agency A", contactEmail: "a@agency.test", contactPhone: "+911111111111", hotelId: hotelA!.id,
  }).returning();
  const [agencyB] = await db.insert(agenciesTable).values({
    name: "Agency B", contactEmail: "b@agency.test", contactPhone: "+912222222222", hotelId: hotelB!.id,
  }).returning();

  const [bookingA] = await db.insert(bookingsTable).values({
    guestName: "Alice Confidential", guestEmail: "alice@guest.test", guestPhone: "+915555555555",
    numberOfRooms: 1, numberOfPersons: 1,
    checkIn: "2099-03-01", checkOut: "2099-03-05",
    roomRent: "5000", addOns: "0", totalCost: "5000", receipt: "1000", balance: "4000",
    notes: "Hotel A only", hotelId: hotelA!.id, agencyId: agencyA!.id,
  }).returning();
  const [bookingB] = await db.insert(bookingsTable).values({
    guestName: "Bob", numberOfRooms: 1, numberOfPersons: 1,
    checkIn: "2099-03-02", checkOut: "2099-03-04",
    roomRent: "7000", addOns: "0", totalCost: "7000", receipt: "0", balance: "7000",
    hotelId: hotelB!.id, agencyId: agencyB!.id,
  }).returning();

  return {
    hotelA: hotelA!.id, hotelB: hotelB!.id,
    agencyA: agencyA!.id, agencyB: agencyB!.id,
    bookingA: bookingA!.id, bookingB: bookingB!.id,
  };
}

export interface ApiResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

export async function api<T = any>(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    formData?: FormData;
    /** Extra request headers, e.g. X-Auth-Transport or X-CSRF-Token. */
    headers?: Record<string, string>;
    /** Cookies to send, as name/value pairs. fetch here keeps no cookie jar. */
    cookies?: Record<string, string>;
  } = {},
): Promise<ApiResponse<T>> {
  const { token, method = "GET", body, formData, cookies } = options;
  const headers: Record<string, string> = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookies && Object.keys(cookies).length > 0) {
    headers["Cookie"] = Object.entries(cookies)
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

export async function login(email: string, password: string = PASSWORD): Promise<string> {
  const res = await api<{ token: string }>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.token;
}

/**
 * Parses Set-Cookie into name -> { value, attributes }.
 *
 * getSetCookie keeps the headers separate; reading the joined `set-cookie`
 * string would split on the commas inside Expires dates.
 */
export interface ParsedCookie {
  value: string;
  attributes: Record<string, string>;
}

export function parseSetCookies(headers: Headers): Record<string, ParsedCookie> {
  const out: Record<string, ParsedCookie> = {};
  for (const raw of headers.getSetCookie()) {
    const [pair, ...rest] = raw.split(";");
    const eq = pair!.indexOf("=");
    if (eq === -1) continue;
    const attributes: Record<string, string> = {};
    for (const attr of rest) {
      const i = attr.indexOf("=");
      if (i === -1) attributes[attr.trim().toLowerCase()] = "";
      else attributes[attr.slice(0, i).trim().toLowerCase()] = attr.slice(i + 1).trim();
    }
    out[pair!.slice(0, eq).trim()] = {
      value: decodeURIComponent(pair!.slice(eq + 1).trim()),
      attributes,
    };
  }
  return out;
}

/** Logs in over cookie transport and returns the cookies a browser would keep. */
export async function loginWithCookies(
  email: string,
  password: string = PASSWORD,
): Promise<{ cookies: Record<string, string>; body: any; raw: Record<string, ParsedCookie> }> {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
    headers: { "X-Auth-Transport": "cookie" },
  });
  if (res.status !== 200) {
    throw new Error(`cookie login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const raw = parseSetCookies(res.headers);
  const cookies = Object.fromEntries(Object.entries(raw).map(([name, c]) => [name, c.value]));
  return { cookies, body: res.data, raw };
}
