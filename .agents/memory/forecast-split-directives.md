---
name: Forecast Split per-SKU directive semantics
description: What each per-SKU adjustment action means in the Forecast Split recommender, and why "cap" alone could not stock a new SKU.
---

# Forecast Split per-SKU directives (UI panel actions)

The recommender enforces per-SKU adjustments deterministically AFTER the main
recommend pass, so planner intent holds regardless of the LLM. Actions and their math:

- **zero** → 0
- **reduce %** → before × (1 − pct/100)
- **increase %** → at least before+1, grows by pct (×0 still grows by +1 only — useless for stocking a 0 SKU)
- **cap MC** → `min(before, cap)` — a CEILING. It can only lower a value, never raise it.
- **set MC** → `max(0, round(valueMC))` — forces an EXACT value, can RAISE a SKU up from 0.

**Why "set" exists:** A NEW SKU with no sales history gets `before = 0` from the
recommender. Capping it at 100 gives `min(0,100)=0`, so the SKU stayed 0 no matter
the cap — there was no way to FORCE a value onto a 0 SKU. "set" fills that gap.

**How to apply / invariants when touching this code:**
- Every directive target is ALWAYS locked (`lockedSkuIds`) so the rebalance pass never mutates it.
- Any action whose result is 0 (zero / cap→0 / reduce→0 / set→0) is added to `zeroedSkuIds`;
  the hard-fallback rebalance must NEVER refill a zeroed row (would silently reverse intent).
- SKUs absent from the LLM's recommendations get a synthetic 0-MC row first, so a directive
  (including set) can still apply to them.
- Keep "cap" a ceiling — do not redefine it to raise values; high-volume planners rely on that.
- Adding a new action means touching BOTH client (SkuAction type, buildSkuDirectives, UI Select/input)
  and server (zod enum, PlannerDirective type, structured mapping, prompt summary, applyDirectiveToRec, zeroedSkuIds).

## Hard stock gate = 2-week reorder point (July 2026 planner rule)

A SKU only receives forecast volume when its PROJECTED stock coverage at the
target month has fallen to **2 weeks or below**. Above 2 weeks projected →
ZERO allocation (hard exclusion, not a soft multiplier).

**Why:** Two user rulings. (1) Hard gate, no soft reductions. (2) "Take IMS
into consideration — whenever it hits 2 weeks of stock, it triggers
order/forecast": reorder-point logic, so a SKU with lots of stock today still
gets volume if IMS drain projects ≤2 weeks by the target month. The original
4-week gate also missed overstocked SKUs entirely because the server computed
each month from its own stored Planning FG row (no carry-forward) — future
months with no row looked like 0 stock.

**How to apply:** Stock projection must come from the SHARED engine
(`getStockLevelAnalysis` — carry-forward closing stock, IMS w/ forecast
fallback, cleared arrivals for intl), never a recomputed per-row view, so the
recommender matches the FG tab. Gate on target-month projected weeks (current
weeks if target outside horizon). The 99-week sentinel gates. Enforce at EVERY
layer (base scores, algo fallback, LLM prompt, post-LLM enforcement, all
rebalance/refill passes incl. new-SKU boost). Only an explicit per-SKU planner
directive overrides.
