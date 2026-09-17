import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CoverZone, SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, SectionNotes, usePerfFormat, ZONE_COLORS } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";
const ZONE_ORDER: CoverZone[] = ["Negative", "Out of Stock", "Critical", "Healthy", "Overstock"];

function zoneCell(zone: CoverZone) {
  return { backgroundColor: ZONE_COLORS[zone], color: zone === "Critical" ? "#111" : "#fff" };
}

export default function InventorySection({ pack, presentation }: SectionProps) {
  const inv = pack.inventory;
  const { fmtMc, fmtPct, fmtWeeks, fmtUsd, unitLabel } = usePerfFormat();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showLostRows, setShowLostRows] = useState(false);
  const zoneCounts = ZONE_ORDER.map((zone) => ({ zone, count: inv.zoneCounts.find((z) => z.zone === zone)?.count ?? 0 }));
  const totalClosing = inv.cover.reduce((a, c) => a + c.closingStock, 0);
  const healthy = inv.zoneCounts.find((z) => z.zone === "Healthy")?.count ?? 0;
  const coverSorted = [...inv.cover].sort((a, b) => (a.weeks ?? Infinity) - (b.weeks ?? Infinity));
  const ef = inv.efficiency;
  const ls = inv.lostSales;
  const trendData = ef.total.trend.map((pt, i) => {
    const row: Record<string, number | string | null> = { label: pt.label, Total: pt.stockToSales };
    ef.byWeight.forEach((g) => { row[g.group] = g.trend[i]?.stockToSales ?? null; });
    return row;
  });
  const limit = presentation ? 8 : 20;

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <div className="grid gap-3 md:grid-cols-4">
        <QuestionCard question="Closing stock" hint="Reconciles with the Planning FG row">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(totalClosing)}</div>
          <div className="text-xs text-muted-foreground">{unitLabel} across {inv.cover.length} SKUs · {healthy} in the healthy band</div>
        </QuestionCard>
        <QuestionCard question="Stock value" hint={inv.stockValue.pricedSharePct === null ? "No wholesale prices set" : `${fmtPct(inv.stockValue.pricedSharePct)} of stock is priced`}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtUsd(inv.stockValue.valueUsd)}</div>
          <div className="text-xs text-muted-foreground">{inv.stockValue.skusMissingPrice.length ? `${inv.stockValue.skusMissingPrice.length} SKU${inv.stockValue.skusMissingPrice.length === 1 ? "" : "s"} without a price` : "every SKU priced"}</div>
        </QuestionCard>
        <QuestionCard question="Service level" hint="Share of SKU-months that were in stock (last 12 months)">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", ls.serviceLevelPct !== null && ls.serviceLevelPct < 95 ? "text-red-700" : "")}>{fmtPct(ls.serviceLevelPct)}</div>
          <div className="text-xs text-muted-foreground">{ls.stockoutMonths} stock-out months · est. {fmtMc(ls.lostMc)} {unitLabel} lost</div>
        </QuestionCard>
        <QuestionCard question="Stock turns" hint="Annualised sell-out ÷ average stock">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{ef.total.turns === null ? "–" : `${ef.total.turns.toFixed(1)}×`}</div>
          <div className="text-xs text-muted-foreground">{ef.total.daysOfInventory === null ? "no sales" : `${Math.round(ef.total.daysOfInventory)} days of inventory`}</div>
        </QuestionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <QuestionCard question="How many SKUs sit in each zone?" hint={`Target ${inv.targetWeeks.low}–${inv.targetWeeks.high} weeks · ${inv.coverFormula}`}>
          <ResponsiveContainer width="100%" height={presentation ? 280 : 240}>
            <BarChart data={zoneCounts} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid stroke={PERF_COLORS.grid} horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="zone" width={90} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v} SKUs`, ""]} />
              <Bar dataKey="count" name="SKUs">{zoneCounts.map((z) => <Cell key={z.zone} fill={ZONE_COLORS[z.zone]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </QuestionCard>
        <QuestionCard question="Which SKUs are tight, and which are heavy?" hint="Every active SKU, least cover first" actions={!presentation && inv.heatmap.rows.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setShowHeatmap((v) => !v)}>{showHeatmap ? "Hide month-by-month" : "Show month-by-month"}</Button> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["SKU", "Weight", `Closing (${unitLabel})`, `Demand / month`, "Weeks", "Zone"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>
                {coverSorted.slice(0, presentation ? 10 : coverSorted.length).map((c) => (
                  <tr className="border-t" key={c.skuId}>
                    <td className={td}>{c.sku}</td><td className={td}>{c.weight}</td><td className={td}>{fmtMc(c.closingStock)}</td><td className={td}>{fmtMc(c.monthlyDemand)}</td>
                    <td className={td}>{fmtWeeks(c.weeks)}</td>
                    <td className={td}><span className="rounded px-2 py-0.5 text-xs font-medium" style={zoneCell(c.zone)}>{c.zone}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {presentation && coverSorted.length > 10 && <p className="mt-2 text-xs text-muted-foreground">+{coverSorted.length - 10} more on the page</p>}
          </div>
          {showHeatmap && !presentation && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr><th className={th}>SKU</th>{inv.heatmap.months.map((m) => <th className={cn(th, "text-center")} key={m}>{m}</th>)}</tr></thead>
                <tbody>
                  {inv.heatmap.rows.map((r) => (
                    <tr className="border-t" key={`${r.sku}-${r.weight}`}>
                      <td className="px-2 py-1 whitespace-nowrap">{r.sku} <span className="text-muted-foreground">{r.weight}</span></td>
                      {r.cells.map((c) => <td key={c.label} className="px-1 py-1 text-center" style={zoneCell(c.zone)} title={`${c.label}: ${fmtMc(c.closing)} ${unitLabel}, ${fmtWeeks(c.weeks)}`}>{c.weeks === null ? "∞" : c.weeks.toFixed(1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QuestionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuestionCard question="Which SKUs will run out first?" hint="Projected from the forecast and planned arrivals only">
          {inv.atRisk.length === 0 ? <EmptyState message="No SKU is projected to run out" /> : (
            <table className="w-full">
              <thead><tr>{["SKU", `Closing (${unitLabel})`, "Weeks", "Runs out", "Next arrival", `Shortfall (${unitLabel})`].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{inv.atRisk.slice(0, limit).map((r) => (
                <tr className="border-t" key={`${r.sku}-${r.weight}`}>
                  <td className={td}>{r.sku}<span className="block text-xs text-muted-foreground">{r.weight}</span></td><td className={td}>{fmtMc(r.closingStock)}</td><td className={td}>{fmtWeeks(r.weeks)}</td>
                  <td className={cn(td, "text-red-700")}>{r.projectedStockoutMonth ?? "–"}{r.projectedStockoutDate && <span className="block text-xs">{r.projectedStockoutDate}</span>}</td>
                  <td className={td}>{r.nextArrival ? `${r.nextArrival.month} (${fmtMc(r.nextArrival.mc)})` : "none planned"}</td><td className={td}>{fmtMc(r.shortfallMc)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </QuestionCard>
        <QuestionCard question="Where is stock sitting too long?" hint={`Cover above ${inv.targetWeeks.high} weeks`}>
          {inv.overstock.length === 0 ? <EmptyState message="No SKU is overstocked" /> : (
            <table className="w-full">
              <thead><tr>{["SKU", `Closing (${unitLabel})`, "Weeks", `Excess (${unitLabel})`, "Months to sell"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{inv.overstock.slice(0, limit).map((r) => (
                <tr className="border-t" key={`${r.sku}-${r.weight}`}>
                  <td className={td}>{r.sku}<span className="block text-xs text-muted-foreground">{r.weight}</span></td><td className={td}>{fmtMc(r.closingStock)}</td><td className={td}>{fmtWeeks(r.weeks)}</td>
                  <td className={td}>{fmtMc(r.excessMc)}</td><td className={td}>{r.monthsToSell === null ? "no demand" : r.monthsToSell.toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </QuestionCard>
      </div>

      {inv.expiryRisk && (
        <QuestionCard question="What might expire before it sells?" hint={`${fmtMc(inv.expiryRisk.totalAtRiskMc)} ${unitLabel} at risk`}>
          {inv.expiryRisk.rows.length === 0 ? <EmptyState message="No stock is projected to expire unsold" /> : (
            <table className="w-full">
              <thead><tr>{["SKU", "Produced", "Expires", "Months left", `Remaining (${unitLabel})`, `At risk (${unitLabel})`].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{inv.expiryRisk.rows.slice(0, limit).map((r, i) => (
                <tr className="border-t" key={`${r.sku}-${r.productionPeriod}-${i}`}>
                  <td className={td}>{r.sku}<span className="block text-xs text-muted-foreground">{r.weight}</span></td><td className={td}>{r.productionPeriod}</td><td className={td}>{r.expiryDate}</td>
                  <td className={cn(td, r.monthsUntilExpiry <= 3 ? "text-red-700" : "")}>{r.monthsUntilExpiry}</td><td className={td}>{fmtMc(r.remainingMc)}</td><td className={td}>{fmtMc(r.atRiskMc)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </QuestionCard>
      )}

      <QuestionCard question="How much did we lose to stock-outs?" hint={ls.method} actions={!presentation && ls.rows.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setShowLostRows((v) => !v)}>{showLostRows ? "Hide months" : "Show every month"}</Button> : undefined}>
        {ls.bySku.length === 0 ? <EmptyState message="No stock-out months in the last 12 months" /> : (
          <>
            <table className="w-full">
              <thead><tr>{["SKU", "Weight", "Stock-out months", `Estimated lost sales (${unitLabel})`].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{ls.bySku.slice(0, limit).map((r) => <tr className="border-t" key={`${r.sku}-${r.weight}`}><td className={td}>{r.sku}</td><td className={td}>{r.weight}</td><td className={td}>{r.months}</td><td className={cn(td, "text-red-700")}>{fmtMc(r.lostMc)}</td></tr>)}</tbody>
            </table>
            {showLostRows && !presentation && (
              <table className="mt-4 w-full text-xs">
                <thead><tr>{["SKU", "Month", "Closing", "Sold", "Run rate", "Lost"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                <tbody>{ls.rows.map((r, i) => <tr className="border-t" key={`${r.sku}-${r.month}-${i}`}><td className="px-2 py-1">{r.sku} <span className="text-muted-foreground">{r.weight}</span></td><td className="px-2 py-1">{r.month}</td><td className="px-2 py-1">{fmtMc(r.closing)}</td><td className="px-2 py-1">{fmtMc(r.ims)}</td><td className="px-2 py-1">{fmtMc(r.runRate)}</td><td className="px-2 py-1 text-red-700">{fmtMc(r.lostMc)}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
      </QuestionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuestionCard question="How efficiently is stock working?" hint="Turns and days of inventory per weight, plus the stock-to-sales ratio over time">
          <table className="w-full">
            <thead><tr>{["Group", "Turns", "Days of inventory", `Avg stock (${unitLabel})`, `Annualised sales (${unitLabel})`].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
            <tbody>{[ef.total, ...ef.byWeight].map((g, i) => (
              <tr className={cn("border-t", i === 0 && "font-semibold bg-muted/40")} key={g.group}><td className={td}>{g.group}</td><td className={td}>{g.turns === null ? "–" : `${g.turns.toFixed(1)}×`}</td><td className={td}>{g.daysOfInventory === null ? "–" : Math.round(g.daysOfInventory)}</td><td className={td}>{fmtMc(g.avgStock)}</td><td className={td}>{fmtMc(g.annualisedIms)}</td></tr>
            ))}</tbody>
          </table>
          {trendData.length > 1 && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={(v: number) => v.toFixed(1)} label={{ value: "stock ÷ month's sales", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v.toFixed(2), ""]} /><Legend />
                <Line dataKey="Total" stroke={PERF_COLORS.accent} strokeWidth={2} dot={false} connectNulls />
                {ef.byWeight.map((g, i) => <Line key={g.group} dataKey={g.group} stroke={PERF_COLORS.series[(i + 1) % PERF_COLORS.series.length]} dot={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          )}
        </QuestionCard>
        <QuestionCard question="How much safety stock does each SKU need?" hint={ef.method}>
          {ef.variability.length === 0 ? <EmptyState message="Not enough history" /> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["SKU", `Avg / month`, "Variability", "Recommended weeks", "Current weeks", "Verdict"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                <tbody>{ef.variability.slice(0, presentation ? 10 : ef.variability.length).map((v) => (
                  <tr className="border-t" key={`${v.sku}-${v.weight}`}>
                    <td className={td}>{v.sku}<span className="block text-xs text-muted-foreground">{v.weight}</span></td><td className={td}>{fmtMc(v.avgIms)}</td>
                    <td className={td}>{v.volatility}{v.cv !== null && <span className="block text-xs text-muted-foreground">CV {v.cv.toFixed(2)}</span>}</td>
                    <td className={td}>{v.recommendedWeeks === null ? "–" : v.recommendedWeeks.toFixed(1)}<span className="block text-xs text-muted-foreground">target {v.targetWeeks}</span></td>
                    <td className={td}>{fmtWeeks(v.currentWeeks)}</td><td className={cn(td, "text-xs")}>{v.verdict}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </QuestionCard>
      </div>

      <SectionNotes notes={inv.notes} />
    </div>
  );
}
