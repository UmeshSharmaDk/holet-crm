---
name: Portable Android source exports
description: Verify Android Studio exports independently of Replit's monorepo dependencies.
---
Validate Android Studio source exports with their own dependency installation and Android bundle build, not symlinked monorepo dependencies.

**Why:** Workspace dependency resolution can conceal missing direct build dependencies or resolve a native entry point outside the exported project. A passing type check alone does not establish that a portable Android project can bundle.

**How to apply:** Keep exports separate from the live artifact, preserve existing Android identifiers, and test the standalone dependency graph before archiving. Clearly distinguish JavaScript/Hermes verification from native compilation, signing, and device installation.

Install and verify the actual Java toolchain before downloading large Android SDKs. Keep reusable native-build tools and caches in a gitignored workspace directory rather than `/tmp`.

**Why:** Changing Nix dependencies can recreate the environment and clear `/tmp`; an installation callback can disconnect even when the package was successfully installed. The Java module's displayed GraalVM version is not its Java language version, and the GraalVM runtime crashed during a native build.

**How to apply:** Check the effective `java -version` after installation, including after a disconnected callback. Prefer a supported standard LTS JDK for Android builds and avoid assuming an SDK in temporary storage will survive environment changes.
