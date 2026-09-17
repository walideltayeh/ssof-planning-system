import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, SectionNotes, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";
const QUADRANT_COLOURS: Record<string, string> = { Stars: PERF_COLORS.positive, "Core earners": PERF_COLORS.accent, "Question marks": PERF_COLORS.warning, Tail: "#9ca3af" };
const QUADRANT_HINT: Record<string, string> = {
  Stars: "Big share and growing — protect supply",
  "Core earners": "Big share, flat or falling — defend",
  "Question marks": "Small share but growing — decide whether to back",
  Tail: "Small share and not growing — rationalise or fix",
};

export default function PortfolioSection({ pack, presentation }: SectionProps) {
  const pf = pack.portfolio;
  const { fmtMc, fmtPct, fmtPctSigned, fmtWeeks, unitLabel } = usePerfFormat();
  const plotted = pf.points.filter((p) => p.growthPct !== null).map((p) => ({ ...p, growthClamped: Math.max(-100, Math.min(200, p.growthPct as number)) }));
  const limit = presentation ? 8 : 30;

  const PointTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as (typeof plotted)[number];
    return (
      <div className="rounded border bg-white p-2 text-xs shadow">
        <div className="font-medium">{p.sku} · {p.weight}</div>
        <div>{fmtMc(p.mc)} {unitLabel} · {fmtPct(p.sharePct)} share · {fmtPctSigned(p.growthPct)} growth</div>
        <div className="text-muted-foreground">{p.quadrant} · {p.flavour} · {p.category}</div>
      </div>
    );
  };

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <div className="grid gap-3 md:grid-cols-4">
        {pf.quadrantCounts.map((q) => (
          <QuestionCard key={q.quadrant} question={q.quadrant} hint={QUADRANT_HINT[q.quadrant]} className="h-full">
            <div className="flex items-baseline gap-2">
              <span className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")} style={{ color: QUADRANT_COLOURS[q.quadrant] }}>{q.count}</span>
              <span className="text-sm text-muted-foreground">SKUs</span>
            </div>
            <div className="text-xs text-muted-foreground">{fmtMc(q.mc)} {unitLabel} · {fmtPct(q.sharePct)} of volume</div>
          </QuestionCard>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <QuestionCard question="Where does each SKU sit?" hint={`${pf.basis}. Split at ${pf.thresholds.shareSplitPct}% share and ${pf.thresholds.growthSplitPct}% growth; bubble size = volume`}>
          {plotted.length === 0 ? <EmptyState message="Growth cannot be measured yet (no last-year sales)" /> : (
            <ResponsiveContainer width="100%" height={presentation ? 380 : 340}>
              <ScatterChart margin={{ left: 8, right: 16, bottom: 8 }}>
                <CartesianGrid stroke={PERF_COLORS.grid} />
                <XAxis type="number" dataKey="sharePct" name="Share" unit="%" label={{ value: "Share of volume %", position: "insideBottom", offset: -4, fontSize: 11 }} />
                <YAxis type="number" dataKey="growthClamped" name="Growth" unit="%" label={{ value: "Growth vs last year %", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <ZAxis type="number" dataKey="mc" range={[40, 400]} />
                <ReferenceLine x={pf.thresholds.shareSplitPct} stroke="#9ca3af" strokeDasharray="4 4" />
                <ReferenceLine y={pf.thresholds.growthSplitPct} stroke="#9ca3af" strokeDasharray="4 4" />
                <Tooltip content={<PointTooltip />} />
                {(["Stars", "Core earners", "Question marks", "Tail"] as const).map((q) => (
                  <Scatter key={q} name={q} data={plotted.filter((p) => p.quadrant === q)} fill={QUADRANT_COLOURS[q]} fillOpacity={0.75} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </QuestionCard>

        <QuestionCard question="Which flavours are winning?" hint="Ranked by volume in the period; movement vs the same months last year">
          {pf.flavours.length === 0 ? <EmptyState message="No flavour data" /> : (
            <table className="w-full">
              <thead><tr>{["#", "Flavour", `Volume (${unitLabel})`, "Share", "Growth", "Movement"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{pf.flavours.slice(0, presentation ? 10 : pf.flavours.length).map((f) => (
                <tr className="border-t" key={f.flavour}>
                  <td className={td}>{f.rank}</td><td className={cn(td, "font-medium")}>{f.flavour}</td><td className={td}>{fmtMc(f.mc)}</td><td className={td}>{fmtPct(f.sharePct)}</td>
                  <td className={cn(td, f.growthPct === null ? "text-muted-foreground" : f.growthPct >= 0 ? "text-green-700" : "text-red-700")}>{fmtPctSigned(f.growthPct)}</td>
                  <td className={cn(td, "text-xs text-muted-foreground")}>{f.movement}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </QuestionCard>
      </div>

      <QuestionCard question="What is in the tail, and what should we do about it?" hint={`${pf.candidates} rationalisation candidate${pf.candidates === 1 ? "" : "s"} · ${fmtMc(pf.tailStockMc)} ${unitLabel} of stock sits in the tail`}>
        {pf.tail.length === 0 ? <EmptyState message="No SKU is in the tail" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["SKU", "Weight", `Volume (${unitLabel})`, "Share", "Zero months (last 3)", "Last sale", `Stock (${unitLabel})`, "Weeks", "Recommendation"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{pf.tail.slice(0, limit).map((t) => (
                <tr className={cn("border-t", t.candidate && "bg-red-50/60")} key={`${t.sku}-${t.weight}`}>
                  <td className={cn(td, "font-medium")}>{t.sku}</td><td className={td}>{t.weight}</td><td className={td}>{fmtMc(t.mc)}</td><td className={td}>{fmtPct(t.sharePct)}</td>
                  <td className={td}>{t.zeroMonthsLast3}</td><td className={td}>{t.monthsSinceLastSale === null ? "never" : t.monthsSinceLastSale === 0 ? "this month" : `${t.monthsSinceLastSale} months ago`}</td>
                  <td className={td}>{fmtMc(t.stockMc)}</td><td className={td}>{fmtWeeks(t.weeks)}</td>
                  <td className={cn(td, "text-xs", t.candidate ? "font-medium text-red-700" : "text-muted-foreground")}>{t.reason}</td>
                </tr>
              ))}</tbody>
            </table>
            {pf.tail.length > limit && <p className="mt-2 text-xs text-muted-foreground">+{pf.tail.length - limit} more in the Excel export</p>}
          </div>
        )}
      </QuestionCard>

      <SectionNotes notes={pf.notes} />
    </div>
  );
}
