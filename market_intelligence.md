# SSOF Planning System — Market Intelligence & Forecast Algorithm Design

## 1. Al Fakher Market Position

- **Global market share**: Al Fakher holds ~40% of the global shisha tobacco market (claimed), making it the #1 brand worldwide.
- **Founded**: 1999, UAE. Factories in UAE, Egypt, Turkey.
- **Distribution**: 90+ markets globally.
- **Key competitors**: Nakhla (JTI/Egypt), Mazaya (Jordan), Romman (Jordan), Al Waha (Jordan), Adalya (Turkey), Starbuzz (USA), Fumari (USA), Social Smoke (USA).

## 2. Country-Specific Intelligence

### Lebanon
- **Market context**: Lebanon has one of the highest tobacco use rates globally (ranked 3rd per capita). Hookah is deeply embedded in social culture.
- **Economic context**: Severe economic crisis since 2019. Currency devaluation means USD-priced imports are premium. Tobacco consumption actually increased from 32% pre-2019 to 61% in 2024 (stress-driven).
- **Al Fakher position**: Dominant premium brand. Competes primarily with Nakhla (budget), local brands.
- **Key competitors**: Nakhla (JTI), Mazaya, local Lebanese brands.
- **Top SKUs**: 250g is the dominant retail size. 50g for trial/gifting. 1kg for lounges.
- **Seasonality**: 
  - **Ramadan** (varies monthly, ~March-April 2025): +30-40% spike in shisha consumption (night socializing after iftar)
  - **Summer** (Jun-Aug): +20-25% (outdoor cafes, tourism, social gatherings)
  - **Winter** (Dec-Feb): -10-15% (reduced outdoor activity)
  - **New Year / Holidays**: +15% (Dec-Jan)

### Syria
- **Market context**: Post-conflict reconstruction. Limited import capacity. Strong domestic hookah culture.
- **Al Fakher position**: Premium brand, competes with local Syrian brands and Egyptian Nakhla.
- **Key competitors**: Nakhla, local Syrian brands, Mazaya.
- **Seasonality**: Similar to Lebanon. Ramadan and summer are peak periods.
- **Economic context**: USD scarcity limits premium imports. 250g is the most accessible size.

### Libya
- **Market context**: Oil-rich but politically unstable. Strong hookah culture. Three local brands (Mars, Tanit, Crystal) collectively hold ~70% of cigarette market, but hookah is dominated by imports.
- **Al Fakher position**: Strong premium position. Competes with Egyptian brands (Nakhla, Eastern Company).
- **Key competitors**: Nakhla, Eastern Company (Egypt), local Libyan brands.
- **Seasonality**: 
  - **Ramadan**: +35-45% (strongest Ramadan effect in North Africa)
  - **Summer**: +15-20%
  - **Winter**: -5-10%

## 3. Top Al Fakher SKUs by Flavor (Global Ranking)

### Tier 1 — Core Bestsellers (always high demand)
1. **Double Apple (Two Apples)** — #1 globally, especially dominant in MENA. Classic anise-apple flavor.
2. **Mint** — #2 globally. Universal appeal, used as mixer.
3. **Grape with Mint** — #3. Signature blend, very popular in Levant.
4. **Blueberry** — #4. Strong in younger demographics.
5. **Watermelon** — #5. Summer peak.

### Tier 2 — Strong Performers
6. **Peach** — Consistent seller, summer peak.
7. **Orange / Orange Mint** — Citrus preference in MENA.
8. **Strawberry** — Popular with younger consumers.
9. **Lemon / Lemon Mint** — Refreshing, summer peak.
10. **Grape** — Classic, consistent.

### Tier 3 — Niche/Seasonal
11. **Mango** — Tropical, summer.
12. **Coconut** — Niche.
13. **Gum / Bubblegum** — Youth segment.
14. **Rose** — Traditional, Ramadan.
15. **Vanilla** — Dessert segment.

## 4. SKU Size Preferences by Channel

| Size | Primary Channel | Sessions | Notes |
|------|----------------|----------|-------|
| 50g | Retail/Trial | 3-5 | Impulse purchase, gifting |
| 250g | Retail/Lounge | 15-20 | Most popular retail size |
| 1kg | Wholesale/Lounge | 60-80 | Lounge/café bulk purchase |

**250g dominates retail in Lebanon, Syria, Libya.** 1kg is primarily for hookah lounges and cafés.

## 5. Multi-Factor Forecasting Algorithm

### Factor 1: Historical IMS Trend (Weight: 35%)
- Rolling 12-month weighted average (recent months weighted higher)
- YoY growth rate per SKU
- Trend direction (accelerating/decelerating/stable)

### Factor 2: Seasonality Index (Weight: 25%)
- Month-specific multiplier based on same-month historical average
- Ramadan adjustment: +35% for the Ramadan month (calendar-aware)
- Summer adjustment: Jun +15%, Jul +20%, Aug +15%
- Winter adjustment: Dec -10%, Jan -15%, Feb -10%

### Factor 3: Stock Health Pressure (Weight: 20%)
- Critical stock (<4 weeks): +15-25% upward pressure on forecast
- Healthy stock (4-8 weeks): neutral
- Overstock (>8 weeks): -10-20% downward pressure
- Near-expiry risk: additional upward pressure to clear

### Factor 4: Market Intelligence & Competitive Context (Weight: 10%)
- Country-specific market growth rate (Lebanon: flat/declining due to crisis; Syria: recovering; Libya: growing)
- Competitive pressure (new entrants, Nakhla price competition)
- SKU tier weighting (Tier 1 SKUs get higher base allocation)
- Flavor trend momentum (emerging vs declining flavors)

### Factor 5: Confidence & Data Quality (Weight: 10%)
- Months of historical data available (more = higher confidence)
- Coefficient of variation in historical shares (low variance = high confidence)
- Recent anomalies (sudden spikes/drops) flagged and discounted

### Output per SKU:
- Recommended mastercases
- Confidence score (0-100%)
- Primary driver (what's driving the recommendation)
- Stock health alert
- Trend direction
- Seasonal adjustment applied
- Competitive context note

## 6. Ramadan Calendar (for algorithm)
- 2025 Ramadan: March 1 - March 30
- 2026 Ramadan: February 18 - March 19
- Effect: +35% (Lebanon/Syria), +40% (Libya) in Ramadan month

## 7. Key Insights for LLM Prompt

The LLM should act as a senior FMCG demand planner with deep knowledge of:
1. Al Fakher's position as the #1 premium shisha brand in MENA
2. The cultural importance of hookah in Lebanon/Syria/Libya (social, not just recreational)
3. The economic pressures in each country affecting purchasing power
4. Ramadan as the single most important demand driver in MENA
5. The dominance of Double Apple and Mint as anchor SKUs
6. Stock health as a hard constraint (critical stock = must increase; overstock = must reduce)
7. The 250g pack as the primary retail unit in these markets
