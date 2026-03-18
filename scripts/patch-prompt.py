#!/usr/bin/env python3
with open('/home/ubuntu/ssof-planning-system/server/routers.ts', 'r') as f:
    content = f.read()

start_marker = 'PER-SKU ANALYTICS:'
end_marker = '  "overallInsight": string,\n  "warnings": string[]\n}`;'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker) + len(end_marker)

new_section = r'''PER-SKU ANALYTICS (IMS History + Stock Health):
${skuSummaries.map(s => {
  const skuObj = skus.find(sk => `${sk.name} ${sk.weight}` === s.name);
  const health = skuObj ? stockHealthBySku[skuObj.id] : null;
  return [
    `SKU: ${s.name} [${s.category}]`,
    `  Avg monthly IMS: ${s.avgMonthly} | Total IMS: ${s.totalIms.toFixed(0)} | Months of data: ${s.monthsOfData}`,
    `  3-month rolling trend vs prior 3 months: ${s.rollingTrend}%`,
    `  YoY growth same month: ${s.yoyGrowth}%`,
    `  Seasonality index for ${monthName}: ${s.seasonalityIndex}`,
    `  Same month prior years: ${s.sameMonthHistory || 'no data'}`,
    `  Full monthly history: ${s.history || 'no data'}`,
    health ? `  STOCK HEALTH: Current=${health.currentWeeks}wks [${health.currentZone}] | In ${monthName}=${health.targetMonthWeeks}wks [${health.targetMonthZone}] | Next month=${health.nextMonthWeeks}wks [${health.nextMonthZone}] | Health score=${health.healthScore}% | Trend=${health.trend}` : '',
    health && health.criticalPeriods.length > 0 ? `  ⚠ CRITICAL STOCK PERIODS: ${health.criticalPeriods.join(', ')}` : '',
    health && health.overstockPeriods.length > 0 ? `  ⚠ OVERSTOCK PERIODS: ${health.overstockPeriods.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}).join('\n\n')}
INSTRUCTIONS:
Using ALL the above data (IMS history + stock health), recommend how to split ${totalMastercases} mastercases across the SKUs for ${monthName} ${targetYear}.
Consider:
1. Historical market share weighted by recency (recent months matter more)
2. Seasonality - use the seasonality index to adjust up/down for this specific month
3. YoY growth trajectory - growing SKUs deserve a higher share than their historical average
4. NPI SKUs with strong early traction should be supported with adequate supply
5. New SKUs (< 6 months data) should be allocated conservatively unless early data shows strong demand
6. STOCK HEALTH IS CRITICAL: SKUs in Critical/Negative/Out-of-Stock zones need MORE allocation to replenish. SKUs in Overstock zones should get LESS allocation to avoid waste. Healthy zone SKUs get their normal share.
7. If a SKU will be in Critical zone in ${monthName}, increase its allocation by 10-25% above its historical share. If Overstock, reduce by 10-20%.
8. Ensure the sum of all recommendedMastercases equals exactly ${totalMastercases}
9. Round to whole mastercases, no fractions
For each SKU provide:
- recommendedMastercases: integer (must sum to exactly ${totalMastercases})
- sharePercent: percentage of total (must sum to 100.0)
- reasoning: 1-2 sentences explaining the recommendation using BOTH IMS data AND stock health
- trend: one of 'growing' | 'stable' | 'declining' | 'new'
- seasonalityNote: specific note on how ${monthName} seasonality affects this SKU
- stockAlert: one of 'critical' | 'healthy' | 'overstock' | 'unknown' — based on the stock health data
Also provide:
- overallInsight: 3-4 sentence strategic summary covering dominant SKUs, seasonal adjustments made, stock health risks, flavour category trends, and key risks
- warnings: array of strings for SKUs with critical stock, overstock, or data gaps
Return ONLY valid JSON matching this schema exactly, no markdown:
{
  "recommendations": [
    { "skuName": string, "weight": string, "category": string, "recommendedMastercases": number, "sharePercent": number, "reasoning": string, "trend": string, "seasonalityNote": string, "stockAlert": string }
  ],
  "overallInsight": string,
  "warnings": string[]
}`;'''

new_content = content[:start_idx] + new_section + content[end_idx:]
with open('/home/ubuntu/ssof-planning-system/server/routers.ts', 'w') as f:
    f.write(new_content)
print("Done. Lines replaced:", content[:start_idx].count('\n')+1, "to", content[:end_idx].count('\n')+1)
