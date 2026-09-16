import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GetBookingResponse,
  ListBookingsResponse,
  GetMeResponse,
  ListHotelsResponse,
  ListAgenciesResponse,
  GetAgencyResponse,
  GetUserResponse,
  GetDashboardStatsResponse,
  GetDashboardForecastResponse,
  GetRevenueStatsResponse,
  GetOccupancyStatsResponse,
} from "@workspace/api-zod";
import { api, login, seedFixtures, startServer, stopServer, type Fixtures } from "./helpers/index.js";

/**
 * Validates live responses against the schemas generated from openapi.yaml.
 *
 * The spec had drifted badly enough to be unusable — it still described
 * roomNumber and roomType, which no longer exist, and never mentioned
 * numberOfRooms or numberOfPersons, which are required columns. Anything
 * generated from it was wrong for the busiest resource in the system, and
 * nothing noticed because nothing checked.
 *
 * Correcting the spec once does not stop that recurring. These assertions make
 * the spec enforceable: change a response shape without updating openapi.yaml,
 * or update the spec without regenerating, and the run fails.
 */
describe("responses match the generated API contract", () => {
  let f: Fixtures;
  let admin: string, ownerA: string;

  before(async () => {
    await startServer();
    f = await seedFixtures();
    admin = await login("admin@test.local");
    ownerA = await login("ownera@test.local");
  });

  after(stopServer);

  /**
   * orval is configured with useDates, so the generated schemas expect Date
   * objects — the generated client converts them as responses are read. JSON
   * cannot carry a Date, so raw bodies are revived the same way before being
   * compared, otherwise every timestamp would report a false mismatch.
   *
   * A string that merely looks like a timestamp would also be converted, which
   * is fine for fixtures but worth knowing if one ever appears in a name field.
   */
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

  function reviveDates(value: unknown): unknown {
    if (typeof value === "string") {
      return ISO_DATE.test(value) ? new Date(value) : value;
    }
    if (Array.isArray(value)) return value.map(reviveDates);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reviveDates(v)]),
      );
    }
    return value;
  }

  /** Reports the offending field rather than a bare "invalid". */
  function check(schema: { safeParse: (v: unknown) => any }, value: unknown, label: string) {
    const result = schema.safeParse(reviveDates(value));
    if (!result.success) {
      const detail = result.error.issues
        .map((i: any) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      assert.fail(`${label} does not match the generated contract — ${detail}`);
    }
  }

  it("GET /bookings/:id", async () => {
    const res = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.equal(res.status, 200);
    check(GetBookingResponse, res.data, "GET /bookings/:id");
  });

  /**
   * safeParse alone does not catch spec drift.
   *
   * zod ignores unknown keys, and a nullable property becomes optional — so a
   * spec describing a field that no longer exists still validates, and a
   * response carrying a field the spec never mentions validates too. That is
   * exactly the drift this issue was about, and a schema check sails straight
   * past it.
   *
   * Comparing the declared shape against the real keys catches both
   * directions. The generated zod object exposes .shape, so the spec's own
   * field list is available at runtime without re-parsing the YAML.
   */
  function checkShape(
    schema: { shape: Record<string, unknown> },
    value: Record<string, unknown>,
    label: string,
  ) {
    const declared = new Set(Object.keys(schema.shape));
    const actual = new Set(Object.keys(value));

    const phantom = [...declared].filter((k) => !actual.has(k));
    const undocumented = [...actual].filter((k) => !declared.has(k));

    assert.deepEqual(
      phantom, [],
      `${label}: the spec declares field(s) the API does not return: ${phantom.join(", ")}`,
    );
    assert.deepEqual(
      undocumented, [],
      `${label}: the API returns field(s) the spec does not declare: ${undocumented.join(", ")}`,
    );
  }

  it("GET /bookings/:id declares exactly the fields it returns", async () => {
    const res = await api(`/api/bookings/${f.bookingA}`, { token: ownerA });
    assert.equal(res.status, 200);
    checkShape(GetBookingResponse as any, res.data, "GET /bookings/:id");

    // The specific drift this issue was filed about.
    assert.equal(typeof res.data.numberOfRooms, "number");
    assert.equal(typeof res.data.numberOfPersons, "number");
  });

  it("GET /auth/me declares exactly the fields it returns", async () => {
    const res = await api(`/api/auth/me`, { token: ownerA });
    checkShape(GetMeResponse as any, res.data, "GET /auth/me");
  });

  it("GET /analytics/occupancy declares exactly the fields it returns", async () => {
    const res = await api(`/api/analytics/occupancy`, { token: ownerA });
    checkShape(GetOccupancyStatsResponse as any, res.data, "GET /analytics/occupancy");
  });

  it("GET /dashboard/stats declares exactly the fields it returns", async () => {
    const res = await api(`/api/dashboard/stats`, { token: ownerA });
    checkShape(GetDashboardStatsResponse as any, res.data, "GET /dashboard/stats");
  });

  it("GET /bookings", async () => {
    const res = await api(`/api/bookings`, { token: ownerA });
    check(ListBookingsResponse, res.data, "GET /bookings");
  });

  it("POST /bookings accepts what the spec documents", async () => {
    const res = await api(`/api/bookings`, {
      token: ownerA, method: "POST",
      body: {
        guestName: "Contract Test",
        checkIn: "2099-06-01",
        checkOut: "2099-06-03",
        roomRent: 1000,
        addOns: 0,
        receipt: 0,
        numberOfRooms: 2,
        numberOfPersons: 3,
        status: "confirmed",
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.numberOfRooms, 2);
    assert.equal(res.data.numberOfPersons, 3);
    check(GetBookingResponse, res.data, "POST /bookings");
  });

  it("GET /auth/me", async () => {
    const res = await api(`/api/auth/me`, { token: ownerA });
    check(GetMeResponse, res.data, "GET /auth/me");
  });

  it("GET /hotels", async () => {
    check(ListHotelsResponse, (await api(`/api/hotels`, { token: admin })).data, "GET /hotels");
  });

  it("GET /agencies and /agencies/:id", async () => {
    check(ListAgenciesResponse, (await api(`/api/agencies`, { token: ownerA })).data, "GET /agencies");
    check(GetAgencyResponse, (await api(`/api/agencies/${f.agencyA}`, { token: ownerA })).data, "GET /agencies/:id");
  });

  it("GET /users/:id", async () => {
    const me = await api(`/api/auth/me`, { token: admin });
    check(GetUserResponse, (await api(`/api/users/${me.data.id}`, { token: admin })).data, "GET /users/:id");
  });

  it("GET /dashboard/stats", async () => {
    check(GetDashboardStatsResponse, (await api(`/api/dashboard/stats`, { token: ownerA })).data, "GET /dashboard/stats");
  });

  it("GET /dashboard/forecast", async () => {
    check(GetDashboardForecastResponse, (await api(`/api/dashboard/forecast`, { token: ownerA })).data, "GET /dashboard/forecast");
  });

  it("GET /analytics/revenue", async () => {
    check(GetRevenueStatsResponse, (await api(`/api/analytics/revenue`, { token: ownerA })).data, "GET /analytics/revenue");
  });

  it("GET /analytics/occupancy", async () => {
    check(GetOccupancyStatsResponse, (await api(`/api/analytics/occupancy`, { token: ownerA })).data, "GET /analytics/occupancy");
  });
});
