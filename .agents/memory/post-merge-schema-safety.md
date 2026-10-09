---
name: Post-merge schema safety
description: Why unrelated merges must not automatically reconcile database schemas.
---
Do not use an unreviewed schema push as generic post-merge setup. Database-changing work must include a separately reviewed, non-interactive migration path.

**Why:** A dependency-only merge triggered a pending guest-ID schema difference, asking whether old data columns should be renamed into encrypted-file reference columns. Automated setup cannot safely infer that data conversion, and a force flag could hide a destructive choice.

**How to apply:** Keep generic setup limited to dependency reconciliation and library rebuilding. When a task intentionally changes persistence, plan its data migration explicitly rather than resolving schema drift by forcing a push.
