import "./helpers/env.js";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAction, consumeAction, type PendingAction } from "../lib/actionToken.js";
import { api, login, seedFixtures, startServer, stopServer } from "./helpers/index.js";

/**
 * A signed action token proved *who* asked and *what* they confirmed, but
 * nothing stopped the same still-valid token from being replayed within its
 * 10-minute TTL — a client retry or a double-tap could apply the same write
 * twice. consumeAction closes that: the token's jti can be inserted into
 * consumed_action_tokens exactly once.
 */
describe("AI action-confirmation tokens are single-use", () => {
  const action: PendingAction = { name: "update_booking", args: { id: 1, status: "cancelled" } };

  it("confirms once and reports already_used on replay", async () => {
    const token = signAction(1, action);
    const first = await consumeAction(token, 1);
    assert.equal(first.status, "confirmed");
    assert.deepEqual((first as any).action, action);

    const second = await consumeAction(token, 1);
    assert.equal(second.status, "already_used");
  });

  it("rejects a garbage token as invalid, not as consumed", async () => {
    const result = await consumeAction("not-a-real-token", 1);
    assert.equal(result.status, "invalid");
  });

  it("two different tokens for the same user consume independently", async () => {
    const tokenA = signAction(2, action);
    const tokenB = signAction(2, action);
    assert.equal((await consumeAction(tokenA, 2)).status, "confirmed");
    assert.equal((await consumeAction(tokenB, 2)).status, "confirmed");
  });

  describe("end to end through /api/ai/chat", () => {
    let ownerA: string;
    let userId: number;

    before(async () => {
      await startServer();
      await seedFixtures();
      ownerA = await login("ownera@test.local");
      const me = await api("/api/auth/me", { token: ownerA });
      userId = me.data.id;
    });

    after(stopServer);

    it("a replayed confirmation does not create the booking twice", async () => {
      const guestName = `Replay Test ${Date.now()}`;
      const token = signAction(userId, {
        name: "create_booking",
        args: { guestName, checkIn: "2099-06-01", checkOut: "2099-06-02", roomRent: 1000 },
      });

      const first = await api("/api/ai/chat", { token: ownerA, method: "POST", body: { confirmToken: token } });
      assert.equal(first.status, 200);
      assert.match(first.data.reply, /done/i, `expected the first confirmation to apply: ${JSON.stringify(first.data)}`);

      const second = await api("/api/ai/chat", { token: ownerA, method: "POST", body: { confirmToken: token } });
      assert.equal(second.status, 200);
      assert.match(second.data.reply, /already used/i, `expected the replay to be refused: ${JSON.stringify(second.data)}`);

      const created = await db.select().from(bookingsTable).where(eq(bookingsTable.guestName, guestName));
      assert.equal(created.length, 1, "the replayed confirmation created a second booking");
    });
  });
});
