---
name: Internal Android distribution
description: Internal distribution is required for Android and iPhone, without a public App Store release.
---
The user wants internal distribution for Android and iPhone, without a public Apple App Store release. A source archive alone is not the requested final distribution file.

**Why:** The user explicitly clarified that they want a downloadable file for internal use rather than an App Store release, then requested iPhone distribution as well.

**How to apply:** Deliver installable files when feasible, state device compatibility and signing limitations, and do not publish automatically. For iPhone requests, clarify direct signed IPA versus private TestFlight rather than assuming a public listing is wanted. Explain hosted-backend reachability separately from app-store publication. Reuse the same signing key for subsequent APK updates; do not expose signing keys or credentials in download artifacts.
