import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
// Before anything that reads configuration at module load: importing the ai
// route pulls in jwt.ts, which throws on a missing secret.
import "./helpers/env.js";
import { db, bookingsTable } from "@workspace/db";
import { executeTool } from "../routes/ai.js";
import type { HotelScope } from "../lib/scope.js";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

/**
 * The assistant's dashboard and revenue tools used to select every booking the
 * caller could see and reduce over the array in Node — for an admin with no
 * hotel selected, the entire table, to produce a handful of numbers.
 *
 * Moving that into SQL is only worth anything if the answers do not change, so
 * each tool is checked against the REST endpoint computing the same figure.
 * Those endpoints have always aggregated in the database, which makes them a
 * usable oracle.
 */
describe("AI aggregation tools", () => {
  let f: Fixtures;
  let ownerA: string, admin: string;
  const ownerScope = (): HotelScope => ({ kind: "hotel", hotelId: f.hotelA });
  const adminScope = (): HotelScope => ({ kind: "all" });
  const ownerUser = () => ({ userId: 2, email: "ownera@test.local", role: "owner", hotelId: f.hotelA });
  const adminUser = () => ({ userId: 1, email: "admin@test.local", role: "admin", hotelId: null });

  before(async () => {
    await startServer();
    f = await seedFixtures();
    ownerA = await login("ownera@test.local");
    admin = await login("admin@test.local");

    // Enough rows that an in-memory reduce and a SQL aggregate could disagree.
    const today = new Date().toISOString().split("T")[0]!;
    const rows = Array.from({ length: 40 }, (_, i) => ({
      guestName: `Bulk ${i}`,
      numberOfRooms: (i % 3) + 1,
      numberOfPersons: (i % 2) + 1,
      checkIn: i % 4 === 0 ? today : `2099-0${(i % 9) + 1}-01`,
      checkOut: i % 4 === 0
        ? new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0]!
        : `2099-0${(i % 9) + 1}-05`,
      roomRent: String(1000 + i * 10),
      addOns: "0",
      totalCost: String(1000 + i * 10),
      receipt: "0",
      balance: String(1000 + i * 10),
      hotelId: i % 2 === 0 ? f.hotelA : f.hotelB,
      agencyId: i % 3 === 0 ? f.agencyA : null,
      status: "confirmed" as const,
    }));
    await db.insert(bookingsTable).values(rows.map((r) => ({
      ...r,
      agencyId: r.hotelId === f.hotelA ? r.agencyId : null,
    })));
  });

  after(stopServer);

  it("dashboard_stats agrees with /dashboard/stats", async () => {
    const tool = await executeTool("dashboard_stats", {}, ownerUser(), ownerScope());
    const rest = await api(`/api/dashboard/stats`, { token: ownerA });

    assert.equal(tool.todayCheckins, rest.data.todayCheckins, "check-ins diverged");
    assert.equal(tool.todayCheckouts, rest.data.todayCheckouts, "check-outs diverged");
    assert.equal(tool.occupiedRooms, rest.data.occupiedRooms, "occupied rooms diverged");
    assert.equal(tool.totalRooms, rest.data.totalRooms, "total rooms diverged");
    assert.equal(tool.occupancyPercentage, rest.data.occupancyPercentage, "occupancy diverged");
    assert.equal(tool.monthlyRevenue, rest.data.monthlyRevenue, "monthly revenue diverged");
  });

  it("dashboard_stats agrees for an admin across every hotel", async () => {
    const tool = await executeTool("dashboard_stats", {}, adminUser(), adminScope());
    const rest = await api(`/api/dashboard/stats`, { token: admin });

    assert.equal(tool.occupiedRooms, rest.data.occupiedRooms);
    assert.equal(tool.totalRooms, rest.data.totalRooms);
    assert.equal(tool.monthlyRevenue, rest.data.monthlyRevenue);
    assert.equal(tool.totalBookings, rest.data.totalBookings);
  });

  it("revenue_summary agrees with /analytics/revenue", async () => {
    const tool = await executeTool("revenue_summary", { year: 2099 }, ownerUser(), ownerScope());
    const rest = await api(`/api/analytics/revenue?year=2099`, { token: ownerA });

    assert.equal(tool.totalRevenue, rest.data.totalYearlyRevenue, "yearly revenue diverged");

    for (const m of rest.data.monthlyRevenue) {
      assert.equal(
        tool.monthlyRevenue[m.month].revenue, m.revenue,
        `month ${m.month} revenue diverged`,
      );
      assert.equal(
        tool.monthlyRevenue[m.month].bookings, m.bookings,
        `month ${m.month} booking count diverged`,
      );
    }
  });

  it("revenue_summary attributes by agency the same way", async () => {
    const tool = await executeTool("revenue_summary", { year: 2099 }, ownerUser(), ownerScope());
    const rest = await api(`/api/analytics/revenue?year=2099`, { token: ownerA });

    for (const entry of rest.data.agencyRevenue) {
      const key = entry.agencyName === "Direct / Walk-in" ? "Direct" : entry.agencyName;
      assert.ok(tool.revenueByAgency[key], `agency "${key}" missing from the tool result`);
      assert.equal(tool.revenueByAgency[key].revenue, entry.revenue, `agency "${key}" revenue diverged`);
    }
  });

  it("occupancy_on_date agrees with /analytics/occupancy on room counts", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const tool = await executeTool("occupancy_on_date", { date: today }, ownerUser(), ownerScope());
    const rest = await api(`/api/dashboard/stats`, { token: ownerA });

    assert.equal(tool.occupiedRooms, rest.data.occupiedRooms, "occupied rooms diverged");
    assert.equal(tool.totalRooms, rest.data.totalRooms);
  });

  it("caps the stay list and says when it did", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const tool = await executeTool("occupancy_on_date", { date: today }, adminUser(), adminScope());

    assert.ok(tool.bookings.length <= 200, "the stay list is unbounded");
    assert.equal(typeof tool.stays, "number", "the true count should be reported even when truncated");
    if (tool.stays > tool.bookings.length) {
      assert.equal(tool.truncated, true, "a truncated list must say so");
      assert.equal(tool.showing, tool.bookings.length);
    }
  });

  it("still refuses to reach beyond the caller's hotel", async () => {
    const tool = await executeTool("dashboard_stats", {}, ownerUser(), ownerScope());
    const everything = await executeTool("dashboard_stats", {}, adminUser(), adminScope());
    assert.ok(
      tool.totalBookings < everything.totalBookings,
      "a tenant saw the same totals as an admin — scoping was lost in the rewrite",
    );
  });
});
