---
name: Gesture verification
description: Lessons from root-level touch handling in Expo web previews.
---
Test gesture outcomes, not only dispatched navigation actions. Use one gesture owner per platform and get tab navigation from the mounted tab navigator.

**Why:** Browser testing showed that a correct intended tab destination could still produce a different visible route, root navigation snapshots could lack usable nested navigator state, and child inputs/scroll views could interrupt root React Native touch observation. A logged action or a passing type check did not establish correct interaction.

**How to apply:** Exercise real touch events with settled routes. Confirm the resulting route, actual refetch requests, and input exclusion. Avoid combining DOM and React Native handlers for the same web gesture. Do not repeatedly run full journeys when a focused failing interaction is enough.
