---
name: Internal Android distribution
description: Internal distribution is required for Android and iPhone, without a public App Store release.
---
The user wants internal distribution for Android and iPhone, without a public Apple App Store release. For iPhone, they selected direct signed IPA files rather than TestFlight invitations. A source archive alone is not the requested final distribution file.

**Why:** The user explicitly clarified that they want a downloadable file for internal use rather than an App Store release, then requested iPhone distribution as well.

**How to apply:** Deliver installable files when feasible, state device compatibility and signing limitations, and do not publish automatically. For iPhone, explain the membership, registered-device, and macOS signing requirements for direct IPA distribution; do not substitute TestFlight without approval. Explain hosted-backend reachability separately from app-store publication. Reuse the same signing key for subsequent APK updates; do not expose signing keys or credentials in download artifacts.
