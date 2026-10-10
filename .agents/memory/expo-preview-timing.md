---
name: Expo preview capture timing
description: A blank early capture can precede font loading, even when the login screen works.
---
Do not treat an early white Expo preview screenshot, with no runtime errors, as proof that the page is broken.

**Why:** Two short captures showed a white page while a browser that waited approximately 15 seconds rendered the complete login screen and handled a rejected sign-in correctly.

**How to apply:** Check running workflows, requests, and font readiness before changing layout or authentication code. When a browser test is already justified, wait for the actual visible controls before assessing screenshots. Avoid repeated immediate captures of the same loading state.
