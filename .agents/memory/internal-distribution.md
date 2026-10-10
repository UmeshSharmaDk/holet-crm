---
name: Internal Android distribution
description: Internal distribution is required for Android and iPhone, without a public App Store release.
---
The user wants internal distribution for Android and iPhone, without a public Apple App Store release. For iPhone, they selected direct signed IPA files rather than TestFlight invitations. A source archive alone is not the requested final distribution file.

**Why:** The user explicitly clarified that they want a downloadable file for internal use rather than an App Store release, then requested iPhone distribution as well.

**How to apply:** Deliver installable files when feasible, state device compatibility and signing limitations, and do not publish automatically. For iPhone, explain the membership, registered-device, and macOS signing requirements for direct IPA distribution; do not substitute TestFlight without approval. Explain hosted-backend reachability separately from app-store publication. Reuse the same signing key for subsequent APK updates; do not expose signing keys or credentials in download artifacts.

Do not equate a successfully signed APK with a working staff login. Verify the APK's configured server returns CRM API responses rather than a hosting-provider sign-in page before presenting login as fixed.

**Why:** The installed internal APK could not log in because the published backend was behind Replit's private-access gate, independent of the CRM's own staff authentication.

**How to apply:** Obtain explicit consent before changing hosting visibility. Preserve staff authentication, hotel permissions, and private identity storage. If access remains blocked, report that blocker clearly rather than calling the release fully functional.

The user approved publicly reachable hosting with CRM staff login retained; this does not authorize an app-store release.

**Why:** Native phones need to reach the CRM API without the separate Replit collaborator-access gate.

**How to apply:** Keep staff login, hotel permissions, and private scan access intact. Treat publishing access as a separate platform setting that the owner must apply; approval is not proof that it has been applied.
