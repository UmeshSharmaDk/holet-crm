---
name: Portable Android source exports
description: Verify Android Studio exports independently of Replit's monorepo dependencies.
---
Validate Android Studio source exports with their own dependency installation and Android bundle build, not symlinked monorepo dependencies.

**Why:** Workspace dependency resolution can conceal missing direct build dependencies or resolve a native entry point outside the exported project. A passing type check alone does not establish that a portable Android project can bundle.

**How to apply:** Keep exports separate from the live artifact, preserve existing Android identifiers, and test the standalone dependency graph before archiving. Clearly distinguish JavaScript/Hermes verification from native compilation, signing, and device installation.
