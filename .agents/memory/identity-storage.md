---
name: Identity document persistence
description: Durability and compatibility constraints for encrypted guest identity photos.
---
Guest identity photos must survive server restarts and remain private and encrypted. Use persistent private object storage for new scans, not autoscale server temporary disk.

**Why:** The product runs on autoscaling servers, where local files are not a durable or shared record. Existing bookings also retain older database-held photos, which must not be lost during unrelated schema changes or roster edits.

**How to apply:** Preserve legacy columns and read compatibility until a reviewed conversion is complete. When editing a roster, carry forward unchanged documents before replacing its rows. Use additive development schema changes; publish applies the corresponding managed production schema changes. Never expose generic public object routes for identity scans.
