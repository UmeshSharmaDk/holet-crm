---
name: Identity document persistence
description: Durability and compatibility constraints for encrypted guest identity photos.
---
Guest identity photos must survive server restarts and remain private and encrypted. Use persistent private object storage for new scans, not autoscale server temporary disk.

**Why:** The product runs on autoscaling servers, where local files are not a durable or shared record. Existing bookings also retain older database-held photos, which must not be lost during unrelated schema changes or roster edits.

**How to apply:** Preserve legacy columns and read compatibility until a reviewed conversion is complete. When editing a roster, carry forward unchanged documents before replacing its rows. Use additive development schema changes; publish applies the corresponding managed production schema changes. Never expose generic public object routes for identity scans.

Normalize camera-sized photos on the client rather than raising buffered upload limits to make oversized files pass.

**Why:** Multiple guests can upload both sides of an ID in one request. Raising per-file limits multiplies server memory use across photos and simultaneous users. Picker quality settings alone do not reliably reduce original files on every platform.

**How to apply:** Verify the real upload flow with photos larger than the server limit, not only tiny synthetic images. Preserve the original draft during preparation and failed saves, and verify resulting documents still print legibly.
