import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, RagBadge, RAG_STYLES, SectionNotes, StatusText, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

export default function RunningRateSection({ pack, presentation }: SectionProps) {
  const r = pack.runningRate;
  const { fmtMc, fmtMcSigned, fmtPctSigned, axisMc, unitLabel } = usePerfFormat();

  if (!r.asOf) {
    return (
      <div className="space-y-4">
        <EmptyState message={r.message} />
        <SectionNotes notes={[r.method, ...r.notes]} />
      </div>
    );
  }

  const figures = [r.headline, r.avg3, r.avg6];
  const trendColour = r.trend.direction === "up" ? "text-green-700" : r.trend.direction === "down" ? "text-red-700" : "text-muted-foreground";
  const driverTable = (rows: typeof r.up, positive: boolean) => (
    <div className="overflow-x-auto">
      <div className={cn("mb-2 font-semibold", positive ? "text-green-700" : "text-red-700")}>{positive ? "Pushing the rate up" : "Pulling the rate down"}</div>
      {rows.length === 0 ? (
        <EmptyState message={positive ? "No SKU is accelerating" : "No SKU is slowing down"} />
      ) : (
        <table className="w-full">
          <thead><tr>{["SKU", "Weight", `Now (${unitLabel}/month)`, "3 months ago", "Change", "Change %"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr className="border-t" key={`${d.sku}-${d.weight}`}>
                <td className={td}>{d.sku}</td><td className={td}>{d.weight}</td><td className={td}>{fmtMc(d.current)}</td>
                <td className={td}>{fmtMc(d.previous)}</td><td className={td}>{fmtMcSigned(d.changeMc)}</td>
                <td className={cn(td, d.changePct === null ? "text-muted-foreground" : d.changePct >= 0 ? "text-green-700" : "text-red-700")}>{fmtPctSigned(d.changePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded border bg-white p-2 text-xs shadow">
        <div className="font-medium">{label}</div>
        {payload.map((p: any) => <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {fmtMc(p.value)}</div>)}
      </div>
    );
  };

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <div className={cn("rounded-xl border-l-8 border-[#7f1d1d] bg-[#7f1d1d]/5 p-4", presentation && "p-6")}>
        <p className={cn("font-medium", presentation ? "text-2xl" : "text-lg")}>{r.message}</p>
        <p className={cn("mt-1 text-sm", trendColour)}>{r.trend.text}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {figures.map((f) => (
          <QuestionCard key={f.label} question={f.label} hint={f.label === "Latest month" ? `Actual IMS in ${r.asOf}` : "Sum of each SKU's average selling month"} className="h-full">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className={cn("font-bold tracking-tight", presentation ? "text-4xl" : "text-3xl")}>{fmtMc(f.value)}</div>
                <div className="text-xs text-muted-foreground">{unitLabel} / month</div>
              </div>
              <span title={f.statusReason}><RagBadge status={f.status} /></span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Plan</dt><dd>{fmtMc(f.plan)} <span className={cn("text-xs", f.vsPlanPct === null ? "text-muted-foreground" : f.vsPlanPct >= 0 ? "text-green-700" : "text-red-700")}>({fmtPctSigned(f.vsPlanPct)})</span></dd>
              <dt className="text-muted-foreground">Last year</dt><dd>{fmtMc(f.lastYear)} <span className={cn("text-xs", f.vsLyPct === null ? "text-muted-foreground" : f.vsLyPct >= 0 ? "text-green-700" : "text-red-700")}>({fmtPctSigned(f.vsLyPct)})</span></dd>
            </dl>
          </QuestionCard>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <QuestionCard question="Annualised" hint="Latest month × 12">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(r.annualised)}</div>
          <div className="text-xs text-muted-foreground">{unitLabel} / year at today's pace</div>
        </QuestionCard>
        <QuestionCard question="Implied weeks of cover" hint={`Closing stock ÷ latest month · target ${r.target.low}–${r.target.high} weeks`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{r.coverWeeks === null ? "∞" : `${r.coverWeeks.toFixed(1)} wks`}</div>
              <div className="text-xs text-muted-foreground">{fmtMc(r.closingStock)} {unitLabel} in stock</div>
            </div>
            <span title={r.coverReason}><RagBadge status={r.coverStatus} /></span>
          </div>
          <p className={cn("mt-2 text-xs", RAG_STYLES[r.coverStatus].text)}>{r.coverReason}</p>
        </QuestionCard>
        <QuestionCard question="Trend" hint="3-month average vs the previous 3 months">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", trendColour)}>{r.trend.pct === null ? "–" : fmtPctSigned(r.trend.pct)}</div>
          <div className="text-xs text-muted-foreground">{r.trend.text}</div>
        </QuestionCard>
      </div>

      <QuestionCard question="How has the run rate moved over the last 24 months?">
        <ResponsiveContainer width="100%" height={presentation ? 360 : 320}>
          <ComposedChart data={r.chart}>
            <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
            <Tooltip content={<ChartTooltip />} /><Legend />
            <Bar dataKey="ims" name="Actual IMS" fill={PERF_COLORS.accent}>{r.chart.map((c) => <Cell key={c.label} fill={PERF_COLORS.accent} fillOpacity={c.isActual ? 1 : 0.35} />)}</Bar>
            <Line dataKey="rate3" name="3-month average" stroke={PERF_COLORS.neutral} strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="rate6" name="6-month average" stroke="#6b7280" strokeWidth={1} dot={false} connectNulls />
            <Line dataKey="plan" name="Plan" stroke={PERF_COLORS.plan} strokeDasharray="5 4" dot={false} />
            <Line dataKey="lastYear" name="Last year" stroke={PERF_COLORS.lastYear} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </QuestionCard>

      <div className="grid gap-4 md:grid-cols-2">
        <QuestionCard question="Run rate by weight" hint="3-month average per group vs plan and last year over the same months">
          <TileTable rows={r.byWeight} unitLabel={unitLabel} fmtMc={fmtMc} fmtPctSigned={fmtPctSigned} />
        </QuestionCard>
        <QuestionCard question="Core vs NPI">
          <TileTable rows={r.byType} unitLabel={unitLabel} fmtMc={fmtMc} fmtPctSigned={fmtPctSigned} />
        </QuestionCard>
      </div>

      <QuestionCard question="Which SKUs are driving the change?" hint="Top 5 each way, 3-month average vs the previous 3 months">
        <div className="grid gap-6 md:grid-cols-2">{driverTable(r.up, true)}{driverTable(r.down, false)}</div>
      </QuestionCard>

      <SectionNotes notes={[r.method, ...r.notes]} />
    </div>
  );
}

function TileTable({ rows, unitLabel, fmtMc, fmtPctSigned }: { rows: SectionProps["pack"]["runningRate"]["byWeight"]; unitLabel: string; fmtMc: (v: number | null) => string; fmtPctSigned: (v: number | null) => string }) {
  if (rows.length === 0) return <EmptyState message="No SKUs in this group" />;
  return (
    <table className="w-full">
      <thead><tr>{["Group", "SKUs", `Rate (${unitLabel}/month)`, "vs plan", "vs last year", "Status"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr className="border-t" key={t.group}>
            <td className={cn(td, "font-medium")}>{t.group}</td><td className={td}>{t.skuCount}</td><td className={td}>{fmtMc(t.current)}</td>
            <td className={td}><StatusText status={t.vsPlanPct === null ? "grey" : t.vsPlanPct >= -5 ? "green" : t.vsPlanPct >= -15 ? "amber" : "red"}>{fmtPctSigned(t.vsPlanPct)}</StatusText></td>
            <td className={cn(td, t.vsLyPct === null ? "text-muted-foreground" : t.vsLyPct >= 0 ? "text-green-700" : "text-red-700")}>{fmtPctSigned(t.vsLyPct)}</td>
            <td className={td}><RagBadge status={t.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
