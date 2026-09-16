import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/env.js";
import { db, rateLimitsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PostgresRateLimitStore } from "../lib/rateLimitStore.js";
import { api, login, seedFixtures, startServer, stopServer } from "./helpers/index.js";

const WINDOW_MS = 60_000;

function makeStore(prefix: string) {
  const store = new PostgresRateLimitStore(prefix);
  store.init({ windowMs: WINDOW_MS } as any);
  return store;
}

/**
 * The point of moving these counters into the database is that they outlive a
 * process and are shared between them. Both properties are asserted directly —
 * a store that silently fell back to memory would still pass a naive
 * "does it count" test.
 */
describe("shared rate limit store", () => {
  before(async () => {
    await db.execute(sql`TRUNCATE TABLE rate_limits`);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE rate_limits`);
  });

  it("counts hits", async () => {
    const store = makeStore("t1");
    assert.equal((await store.increment("a")).totalHits, 1);
    assert.equal((await store.increment("a")).totalHits, 2);
    assert.equal((await store.increment("a")).totalHits, 3);
  });

  it("keeps a count that a second instance can see", async () => {
    // Stands in for a second process: same prefix, same database, no shared memory.
    const first = makeStore("t2");
    const second = makeStore("t2");

    await first.increment("shared");
    await first.increment("shared");
    const seen = await second.increment("shared");

    assert.equal(seen.totalHits, 3, "the second instance started its own count");
  });

  it("survives a restart", async () => {
    const before = makeStore("t3");
    await before.increment("persisted");
    await before.increment("persisted");

    // A fresh instance is all a restart amounts to for this store.
    const afterRestart = makeStore("t3");
    const seen = await afterRestart.get("persisted");

    assert.equal(seen?.totalHits, 2, "the count was lost across the restart");
  });

  it("keeps separate limiters from colliding", async () => {
    const login = makeStore("login");
    const upload = makeStore("guest-upload");

    await login.increment("user-1");
    await login.increment("user-1");
    const uploadSeen = await upload.increment("user-1");

    assert.equal(uploadSeen.totalHits, 1, "two limiters shared one budget");
  });

  it("starts a new window once the old one expires", async () => {
    const store = makeStore("t4");
    await store.increment("expiring");
    await store.increment("expiring");

    // Age the stored window rather than waiting a minute for it.
    await db.execute(sql`UPDATE rate_limits SET reset_time = now() - interval '1 second'`);

    assert.equal((await store.increment("expiring")).totalHits, 1, "the expired window was not reset");
  });

  it("reports an expired window as absent rather than stale", async () => {
    const store = makeStore("t5");
    await store.increment("stale");
    await db.execute(sql`UPDATE rate_limits SET reset_time = now() - interval '1 second'`);
    assert.equal(await store.get("stale"), undefined);
  });

  it("supports reset and decrement", async () => {
    const store = makeStore("t6");
    await store.increment("k");
    await store.increment("k");
    await store.decrement("k");
    assert.equal((await store.get("k"))?.totalHits, 1);

    await store.resetKey("k");
    assert.equal(await store.get("k"), undefined);
  });
});

/**
 * The store is only useful if the limiters actually use it, so this checks the
 * wiring rather than the implementation.
 */
describe("login throttle uses the shared store", () => {
  before(async () => {
    await startServer();
    await seedFixtures();
    await db.execute(sql`TRUNCATE TABLE rate_limits`);
  });

  after(stopServer);

  it("records failed login attempts in the database", async () => {
    await api(`/api/auth/login`, {
      method: "POST", body: { email: "ownera@test.local", password: "wrong-password" },
    });

    const rows = await db.select().from(rateLimitsTable);
    const loginRows = rows.filter((r) => r.key.startsWith("login:"));
    assert.ok(loginRows.length > 0, "the failed attempt was not recorded in the shared store");
    assert.ok(
      loginRows.some((r) => r.key.includes("ownera@test.local")),
      `expected a key for the attempted account, saw: ${loginRows.map((r) => r.key).join(", ")}`,
    );
  });

  it("does not spend budget on a successful login", async () => {
    await db.execute(sql`TRUNCATE TABLE rate_limits`);
    await login("managera@test.local");

    // skipSuccessfulRequests does not skip the increment — express-rate-limit
    // counts the request and decrements once the response comes back clean. So
    // a row is expected; what matters is that it holds no hits.
    const rows = await db.select().from(rateLimitsTable);
    const loginRows = rows.filter((r) => r.key.startsWith("login:"));
    const spent = loginRows.reduce((total, r) => total + r.hits, 0);
    assert.equal(spent, 0, `a successful login consumed ${spent} of the throttle budget`);
  });
});
