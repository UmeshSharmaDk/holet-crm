---
name: Android bundled backend host
description: Expo public environment changes can be missed by incremental Gradle builds.
---
When an installed Android app's backend host changes, check the hostname embedded in its release JS bundle before delivering the APK; a higher Android version code and a successful build do not establish that the bundled host changed.

**Why:** An incremental release build reported success and produced an APK with the new version, but reused the previous JS bundle containing the old host. The public Expo environment variable was not treated as an input change by the bundle task.

**How to apply:** Invalidate the generated JS bundle when the public backend host changes, rebuild, then inspect the new APK's embedded bundle and compare its signing certificate with the installed version. Keep dev-preview and APK backend hosts distinct.
