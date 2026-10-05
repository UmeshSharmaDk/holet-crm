import "./helpers/env.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storeIdImage, readIdImage, deleteIdImage, settleAndCleanUpOnFailure } from "../lib/idFileStore.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/**
 * The guest roster route writes each guest's ID image independently, in
 * parallel. If guest 3's write throws after guest 1 and 2's already
 * succeeded, those two files must not be left on disk with nothing pointing
 * at them — which is exactly what Promise.all would do, since a rejection
 * there discards every already-resolved value.
 */
describe("settleAndCleanUpOnFailure", () => {
  it("returns every value and its new keys when the whole batch succeeds", async () => {
    const { values, newKeys } = await settleAndCleanUpOnFailure([
      async () => {
        const stored = await storeIdImage(JPEG);
        return { value: stored.key, newKeys: [stored.key] };
      },
      async () => {
        const stored = await storeIdImage(JPEG);
        return { value: stored.key, newKeys: [stored.key] };
      },
    ]);
    assert.equal(values.length, 2);
    assert.deepEqual(newKeys.sort(), values.slice().sort());
    for (const key of values) {
      assert.ok(await readIdImage(key), `expected ${key} to be readable`);
    }
  });

  it("deletes files already written by other tasks when one task fails", async () => {
    let survivorKey = "";
    await assert.rejects(
      settleAndCleanUpOnFailure([
        async () => {
          const stored = await storeIdImage(JPEG);
          survivorKey = stored.key;
          return { value: stored.key, newKeys: [stored.key] };
        },
        async () => {
          throw new Error("simulated write failure");
        },
      ]),
      /simulated write failure/,
    );

    assert.ok(survivorKey, "the first task should have written a file before the batch failed");
    await assert.rejects(
      readIdImage(survivorKey),
      "the successful task's file was still readable after the batch it belonged to failed",
    );
  });

  it("a task whose second write fails must clean up its own first write before rethrowing", async () => {
    // Models the guest-roster route's per-guest task: front succeeds, then
    // back throws. The task promise rejects *before* it ever returns a
    // newKeys list, so settleAndCleanUpOnFailure never learns the front key
    // exists — it is the task's own responsibility to not leave it behind.
    let frontKey = "";
    await assert.rejects(
      settleAndCleanUpOnFailure([
        async () => {
          const front = await storeIdImage(JPEG);
          frontKey = front.key;
          try {
            throw new Error("simulated back-write failure");
          } catch (error) {
            await deleteIdImage(front.key);
            throw error;
          }
        },
      ]),
      /simulated back-write failure/,
    );

    assert.ok(frontKey, "the front write should have happened before the simulated failure");
    await assert.rejects(
      readIdImage(frontKey),
      "the front file leaked on disk after the back write in the same task failed",
    );
  });

  it("never calls deleteIdImages for a key that was only carried forward, not newly written", async () => {
    const carriedKey = (await storeIdImage(JPEG)).key;

    await assert.rejects(
      settleAndCleanUpOnFailure([
        async () => ({ value: carriedKey, newKeys: [] }), // unchanged from a previous row — not this batch's to delete
        async () => {
          throw new Error("simulated write failure");
        },
      ]),
      /simulated write failure/,
    );

    assert.ok(await readIdImage(carriedKey), "a carried-forward key was deleted even though this batch never wrote it");
  });
});
