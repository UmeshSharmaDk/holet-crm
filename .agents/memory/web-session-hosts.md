---
name: Web session hosts
description: Expo web preview and API use different hosts, affecting cookie-authenticated writes.
---
Keep the web session token in its httpOnly cookie. Do not assume the Expo web preview can read cookies belonging to the API host; obtain the CSRF value through a CORS-approved response when needed.

**Why:** The mobile preview and API are served from separate development hosts. Login with a pre-existing session cookie and record writes can fail CSRF checks even when the browser correctly sends the session cookie.

**How to apply:** Preserve credentials-included requests and CSRF checks for web writes. Test both a fresh session and signing in again with an old cookie. Never solve cross-host cookie visibility by exposing the session token or disabling CSRF protection.
