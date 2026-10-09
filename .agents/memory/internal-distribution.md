---
name: Internal Android distribution
description: The product's distribution goal is a downloadable Android APK, not an App Store release.
---
The user wants an installable Android APK for internal distribution. A source archive alone is not the requested final distribution file, and Apple App Store publishing is not part of this goal.

**Why:** The user explicitly clarified that they want a downloadable file for internal use rather than an App Store release.

**How to apply:** Deliver an installable APK when feasible, state device compatibility and signing limitations, and do not publish automatically. Explain hosted-backend reachability separately from app-store publication. Reuse the same signing key for subsequent APK updates; do not expose signing keys or credentials in download artifacts.
