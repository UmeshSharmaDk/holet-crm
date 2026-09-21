import "./helpers/env.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPendingActionResponse } from "../routes/ai.js";
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
});
