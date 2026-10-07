---
name: Expo dependency alignment
description: Non-obvious React type resolution constraints when aligning Expo dependencies in this pnpm workspace.
---

Keep shared React runtime and type versions compatible with the installed Expo SDK; do not force an older React type major to accommodate a library.

**Why:** A global React 18 type override masked incompatibility with React 19. Removing it exposed another issue: with automatic peer installation disabled, libraries that import React in their declarations without declaring its types as a peer can lose access to React types. Expo's dependency checks alone do not detect this.

**How to apply:** After aligning versions, run workspace type checks as well as Expo's compatibility check and Expo Doctor. If class components appear to lack `props` or gesture view declarations lose `children`, inspect transitive React type resolution before changing application components. Shared root type tooling can supply the missing declaration resolution without altering runtime behavior.
