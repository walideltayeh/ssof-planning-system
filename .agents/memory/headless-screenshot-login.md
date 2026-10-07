---
name: Headless screenshots of logged-in pages
description: How to visually verify pages behind the SSOF login when the Screenshot tool only ever shows the login page.
---
The built-in Screenshot tool cannot get past the login page (no cookie / localStorage session).

Use isolated browser API fixtures when visual verification needs signed-in content. Do not create public auto-login pages, embed credentials, or remove application authentication for a screenshot.

**Why:** Temporary public login helpers can accidentally ship. Browser-scoped request interception checks the real rendered components without exposing accounts or mutating live records.

**How to apply:** Intercept every API request in an isolated browser session and use synthetic users/data only. Drive the bundled Chromium via CDP, keeping authentication intact in app code. State explicitly that signed-in visual checks used fixtures rather than a live account.

Keep the fixture-controlling CDP connection alive through capture. Closing it releases request interception and subsequent authentication requests can sign the synthetic session out; reconnecting does not restore the rendered signed-in state.

Browser checks must wait for the requested route and its real data-dependent controls, not just a table.

**Why:** Loading skeletons also contain tables, and navigation can briefly expose the previous page. A generic table check can report a missing control or a successful reversal before the new screen has loaded.

**How to apply:** Assert the requested path and a page-specific non-skeleton control before clicking or capturing. Check evaluation exceptions explicitly; do not treat an undefined result as success.
