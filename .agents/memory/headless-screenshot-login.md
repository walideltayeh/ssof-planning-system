---
name: Headless screenshots of logged-in pages
description: How to visually verify pages behind the SSOF login when the Screenshot tool only ever shows the login page.
---
The built-in Screenshot tool cannot get past the login page (no cookie / localStorage session).

**What works:** run the bundled headless browser at `/repl/tools/bin/chromium` against the **https dev domain** (`$REPLIT_DEV_DOMAIN`), pointed at a *temporary* static html page in `client/public/` that calls `appUsers.verifyLogin` via fetch, writes the `ssof-session-v2` localStorage entry (`{ user, country }`) and then `location.replace()`s to the page under test. Flags: `--headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=W,H --virtual-time-budget=30000 --screenshot=/tmp/x.png URL`.

**Why https, not 127.0.0.1:** the server sets the session cookie with `SameSite=None`; over plain http it lacks `Secure`, so Chrome drops it, every tRPC call returns 401 and the app bounces back to the login page.

**How to apply:** delete the temporary html file immediately after the screenshot — it hardcodes credentials and `client/public` ships to production. Node here has no `ws` package and no global WebSocket, so driving CDP by hand is not worth it.
