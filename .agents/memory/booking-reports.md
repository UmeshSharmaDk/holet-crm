---
name: Booking report policy
description: Completeness, page count, and privacy requirements for booking PDF exports.
---
Booking PDFs must include all recorded booking details, guest profiles, financial data, notes, and available front/back identity scans.

**Why:** The user requested a complete printable booking form with identity documents, preferably as a one-page report. Completeness takes priority when a large roster or long notes cannot fit legibly on one page.

**How to apply:** Aim for compact A4 output for ordinary bookings; allow continuation pages rather than truncating records or dropping scans. Distinguish documents not uploaded from uploaded documents that cannot be read. Keep exports scoped to booking permissions, uncached, and audited because they contain sensitive identity data.

**Verification:** Exercise the real form-to-upload-to-PDF path with selected photos, not only a report generated from seeded database images. Report-only fixtures can pass while multipart serialization or storage prevents users' photos from ever being saved. Failed guest/photo uploads must retain the draft and support retry without duplicate bookings.
