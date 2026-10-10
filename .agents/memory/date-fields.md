---
name: Date field policy
description: Product requirement for editable dates in Hotel CRM.
---
All editable calendar dates must use date-picker fields, not plain textboxes, on both web and native mobile. This includes guest date of birth and booking check-in/check-out in both create and edit forms.

**Why:** The user explicitly requires date pickers for all date fields and reported that the web preview was showing textboxes.

**How to apply:** Keep this consistent for future date fields. Preserve date-only values and the applicable limits, such as no future birth dates and check-out after check-in. Read-only date displays do not need an input control.
