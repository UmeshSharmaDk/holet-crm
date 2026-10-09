---
name: Refresh behavior
description: Product requirement for gestures and freshness after record changes.
---
Related pages should refresh immediately after records are added or updated anywhere in Hotel CRM, including confirmed AI changes. Refreshing must preserve unsaved form drafts.

**Why:** The user explicitly requires immediate related-page updates and left/right navigation with downward pull-to-refresh. Background refresh should not cause data loss in an open form.

**How to apply:** Include all dependent views when adding write operations. Treat successful persistence separately from any subsequent refresh failure, and do not reinitialize draft fields on background query updates.
