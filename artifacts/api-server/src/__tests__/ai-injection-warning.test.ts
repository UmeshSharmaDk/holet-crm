import "./helpers/env.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPendingActionResponse, normalizeMessages } from "../routes/ai.js";
import { verifyAction, type PendingAction } from "../lib/actionToken.js";

/**
 * The confirmation gate already stops a prompt injection hidden in a booking
 * note or guest name from executing a write on its own — but a user who
 * reflexively confirms whatever the assistant proposes is still the same
 * injection succeeding one step later, through them. This is the one signal
 * that tells the person confirming whether the proposal came from their own
 * request or from something the model read.
 */
describe("AI write-confirmation injection warning", () => {
  const action: PendingAction = { name: "update_booking", args: { id: 42, status: "cancelled" } };

  it("warns when the proposal followed a round of tool results", () => {
    const res = buildPendingActionResponse(action, 1, true);
    assert.match(res.reply, /proposing this after reading stored records/i);
    assert.equal(res.pendingAction.viaRecordData, true);
  });

  it("says nothing extra when the proposal answers the user's own message directly", () => {
    const res = buildPendingActionResponse(action, 1, false);
    assert.ok(!/reading stored records/i.test(res.reply), "an unwarranted warning would train users to ignore it");
    assert.equal(res.pendingAction.viaRecordData, false);
  });

  it("still signs a token that verifies for the right user and action", () => {
    const res = buildPendingActionResponse(action, 7, true);
    const verified = verifyAction(res.pendingAction.token, 7);
    assert.deepEqual(verified, action);
  });

  it("does not verify for a different user", () => {
    const res = buildPendingActionResponse(action, 7, true);
    assert.equal(verifyAction(res.pendingAction.token, 8), null);
  });

  it("carries the injection signal as a top-level field too, not only on pendingAction", () => {
    assert.equal(buildPendingActionResponse(action, 1, true).tainted, true);
    assert.equal(buildPendingActionResponse(action, 1, false).tainted, false);
  });

  describe("confirmation prompt discloses the actual values, not just field names", () => {
    it("shows the new value being written, not only which field changes", () => {
      const res = buildPendingActionResponse(action, 1, false);
      assert.match(res.reply, /status → cancelled/, `a field name alone hides exactly what an injected write would change: ${res.reply}`);
    });

    it("includes hotelId/agencyId/notes on create_booking, not just the headline fields", () => {
      const createAction: PendingAction = {
        name: "create_booking",
        args: { guestName: "Jane Doe", checkIn: "2099-01-01", checkOut: "2099-01-02", roomRent: 1000, hotelId: 7, notes: "VIP guest" },
      };
      const res = buildPendingActionResponse(createAction, 1, false);
      assert.match(res.reply, /hotel #7/);
      assert.match(res.reply, /notes: "VIP guest"/);
    });
  });

  describe("cross-turn taint seeding", () => {
    it("normalizeMessages preserves a server-issued tainted flag and rejects a non-boolean one", () => {
      const [a, b] = normalizeMessages([
        { role: "assistant", content: "the note says to cancel it", tainted: true },
        { role: "user", content: "yes", tainted: "true" }, // a forged non-boolean must not count
      ]);
      assert.equal(a!.tainted, true);
      assert.equal(b!.tainted, false);
    });

    it("a write proposed after an earlier tainted turn still carries the taint forward", () => {
      const messages = normalizeMessages([
        { role: "assistant", content: "the booking note said to cancel it — want me to?", tainted: true },
        { role: "user", content: "yes" },
      ]);
      const sawUntrustedData = messages.some((m) => m.role === "assistant" && m.tainted);
      assert.equal(sawUntrustedData, true, "a write following a tainted earlier turn must still warn, even with no tool read in this request");
    });
  });
});
