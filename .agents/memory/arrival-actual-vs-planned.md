---
name: Arrival / Forecast-vs-Actual — entered production auto-counts as actual
description: How "actual production" is derived on the intl Arrival and Forecast-vs-Actual pages, and why the plan/actual separation was reversed.
---

Entered production automatically counts as **actual/confirmed** — there is no separate "enter actuals" step.

**Rule:** On the intl pages, `actualMap` derives the actual quantity from the **sum of weekly production (shipment weeks week1–4)** for each `(sku, period)`, and a manual `actual_production_data` entry (> 0) overrides it. `plannedTotal` stays = forecast. So a batch is "confirmed" once any production (shipment weeks) is entered; it's "awaiting actual" only when a forecast plan exists but no production has been entered.

**Why:** The user explicitly chose "treat what I enter as production as the actual automatically — show it as Actual and as confirmed arrivals everywhere, without a separate step." This REVERSES an earlier deliberate decision (old code comment claimed weekly shipment data must NOT promote a row to confirmed). The user's newer direction wins. Do not "fix" this back to requiring a separate manual actual entry.

**How to apply:** Any future work on `client/src/pages/ArrivalPage.tsx` or `client/src/pages/ForecastVsForecastPage.tsx` must keep the shipment-weeks fallback feeding the Actual/Confirmed values. Note: assigning a forecast week (`updateForecastWeek`, Syria/Libya) copies the forecast value into a shipment week, so for those countries actual often equals planned (variance 0) — that is expected, not a bug.

**Unrelated, keep as-is:** "Expected Arrivals" dashboard card still uses **planned-only** (forecast), per separate explicit user direction. Arrival timeline still needs a per-batch arrival lead time (offset days > 0) to compute an arrival date; batches with offset 0 still list under their period but have no date.
