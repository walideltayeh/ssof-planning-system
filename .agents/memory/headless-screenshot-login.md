---
name: Headless screenshots of logged-in pages
description: How to visually verify pages behind the SSOF login when the Screenshot tool only ever shows the login page.
---
The built-in Screenshot tool cannot get past the login page (no cookie / localStorage session).

Use isolated browser API fixtures when visual verification needs signed-in content. Do not create public auto-login pages, embed credentials, or remove application authentication for a screenshot.

**Why:** Temporary public login helpers can accidentally ship. Browser-scoped request interception checks the real rendered components without exposing accounts or mutating live records.

**How to apply:** Intercept every API request in an isolated browser session and use synthetic users/data only. Drive the bundled Chromium via CDP, keeping authentication intact in app code. State explicitly that signed-in visual checks used fixtures rather than a live account.
