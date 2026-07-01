---
name: Arrival / Forecast-vs-Actual — entered production auto-counts as actual
description: How "actual production" is derived on the intl Arrival and Forecast-vs-Actual pages, and why the plan/actual separation was reversed.
---

Entered production automatically counts as **actual/confirmed** — there is no separate "enter actuals" step. A manual `actual_production_data` entry (> 0) always overrides. The two intl pages derive the auto-actual from **different source tables** — do not unify them.

**Forecast-vs-Actual page (`ForecastVsForecastPage.tsx`) + its Excel sheet (`buildIntlForecastVsActualSheet`):** the Actual row mirrors the **Forecast Production (`forecast_data`)** for the same month, manual actual (> 0) overriding. Do NOT derive it from shipment weeks here: `forecast_data` and `shipment_data` are month-shifted for Syria/Libya (the production/lead-time offset means e.g. Apr forecast lands in Mar shipment), so a shipment-based actual leaves months with forecast-but-no-shipment showing Actual 0 — the exact mismatch the user reported.

**Arrival page (`ArrivalPage.tsx`):** actual/confirmed derives from the **sum of weekly production (shipment weeks week1–4)**, manual actual (> 0) overriding — arrivals ARE the shipment batches, so shipment-based is correct there.

**Why:** The user chose "treat what I enter as production as the actual automatically — show it as Actual and as confirmed arrivals everywhere, without a separate step." This REVERSES an earlier deliberate plan/actual separation. The user's newer direction wins; don't "fix" it back to requiring a separate manual actual entry.

**How to apply:** Keep the auto-actual fallback on both pages, but keep the sources distinct (forecast for Forecast-vs-Actual, shipment weeks for Arrival). Note: assigning a forecast week (`updateForecastWeek`, Syria/Libya) copies the forecast value into a shipment week — that coupling is why variance is often 0, but it is not the source for the Forecast-vs-Actual actual row.

**Unrelated, keep as-is:** "Expected Arrivals" dashboard card still uses **planned-only** (forecast), per separate explicit user direction. Arrival timeline still needs a per-batch arrival lead time (offset days > 0) to compute an arrival date; batches with offset 0 still list under their period but have no date.
