---
name: Per-country local UI mirrors
description: Client pages that mirror per-country server data into local state must rebuild from fresh defaults on every refresh/country switch.
---

Rule: when a page keeps a local editable mirror of per-country server data (drafts, POSM lists, rule editors), every hydration must start from a **fresh default object** and overlay only the rows the current country actually has — never merge into previous state — and the country-switch guard must also reset the mirror.

**Why:** merging (`setState(prev => ...overlay)`) leaks country A's drafts into country B whenever B has no saved rows yet; users can then silently persist A's values into B. Caught by architect review on the Trade Offers FOC rules editor.

**How to apply:** any `useEffect` hydrating local state from a country-scoped query: build `defaults()`, overlay rows, `setState(next)` wholesale. Also clear the mirror in the country-change guard alongside other per-country resets.
