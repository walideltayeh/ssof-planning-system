import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, RagBadge, SectionNotes, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

export default function SupplySection({ pack, presentation }: SectionProps) {
  const s = pack.supply;
  const { fmtMc, fmtMcSigned, fmtPct, axisMc, unitLabel } = usePerfFormat();
  const chartH = presentation ? 340 : 300;
  const totalPlan = s.attainment.reduce((a, m) => a + m.plan, 0);
  const totalActual = s.attainment.reduce((a, m) => a + m.actual, 0);
  const attainmentPct = totalPlan > 0 ? (totalActual / totalPlan) * 100 : null;
  const attainmentRag = attainmentPct === null ? "grey" : attainmentPct >= 95 ? "green" : attainmentPct >= 85 ? "amber" : "red";
  const onTimeRag = s.onTimePct === null ? "grey" : s.onTimePct >= 90 ? "green" : s.onTimePct >= 75 ? "amber" : "red";
  const lastGap = s.cumulative[s.cumulative.length - 1]?.gap ?? null;

  const QtyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded border bg-white p-2 text-xs shadow">
        <div className="font-medium">{label}</div>
        {payload.map((p: any) => <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" ? fmtMc(p.value) : "–"}</div>)}
      </div>
    );
  };

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <div className="grid gap-3 md:grid-cols-3">
        <QuestionCard question="Production vs plan" hint="Produced ÷ planned production for the period">
          <div className="flex items-start justify-between gap-2">
            <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtPct(attainmentPct)}</div>
            <RagBadge status={attainmentRag} />
          </div>
          <div className="text-xs text-muted-foreground">{fmtMc(totalActual)} of {fmtMc(totalPlan)} {unitLabel}</div>
        </QuestionCard>
        <QuestionCard question="Arrivals on time" hint={s.onTimeNote}>
          <div className="flex items-start justify-between gap-2">
            <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtPct(s.onTimePct)}</div>
            <RagBadge status={onTimeRag} />
          </div>
          <div className="text-xs text-muted-foreground">share of planned arrivals that landed in month</div>
        </QuestionCard>
        <QuestionCard question="Production ahead of sell-out" hint="Cumulative production − cumulative sell-out over the chart window">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", lastGap !== null && lastGap < 0 ? "text-red-700" : "")}>{fmtMcSigned(lastGap)}</div>
          <div className="text-xs text-muted-foreground">{unitLabel} — negative means we sold more than we made</div>
        </QuestionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuestionCard question="Did we produce what we planned each month?">
          {s.attainment.length === 0 ? <EmptyState message="No production plan for this period" /> : (
            <ResponsiveContainer width="100%" height={chartH}>
              <ComposedChart data={s.attainment}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
                <Tooltip content={<QtyTooltip />} /><Legend />
                <Bar dataKey="plan" name="Planned production" fill={PERF_COLORS.plan} />
                <Bar dataKey="actual" name="Produced" fill={PERF_COLORS.accent} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </QuestionCard>
        <QuestionCard question="Is production keeping up with sell-out?" hint="Cumulative view: the gap between the lines is stock being built or consumed">
          {s.cumulative.length === 0 ? <EmptyState message="No data" /> : (
            <ResponsiveContainer width="100%" height={chartH}>
              <ComposedChart data={s.cumulative}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} />
                <Tooltip content={<QtyTooltip />} /><Legend />
                <Area dataKey="cumulativeProduction" name="Cumulative production" stroke={PERF_COLORS.neutral} fill={PERF_COLORS.neutral} fillOpacity={0.08} />
                <Line dataKey="cumulativeIms" name="Cumulative sell-out" stroke={PERF_COLORS.accent} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </QuestionCard>
      </div>

      <QuestionCard question="Did arrivals land when planned?" hint="Planned (Expected Arrivals) vs actual arrivals per month">
        {s.arrivals.length === 0 ? <EmptyState message="No arrivals in this period" /> : (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <ResponsiveContainer width="100%" height={chartH}>
              <ComposedChart data={s.arrivals}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} />
                <Tooltip content={<QtyTooltip />} /><Legend />
                <Bar dataKey="planned" name="Planned" fill={PERF_COLORS.plan} />
                <Bar dataKey="actual" name="Arrived" fill={PERF_COLORS.accent} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["Month", "Planned", "Arrived", "Variance"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                <tbody>{s.arrivals.map((m) => (
                  <tr className="border-t" key={m.label}><td className={td}>{m.label}</td><td className={td}>{fmtMc(m.planned)}</td><td className={td}>{fmtMc(m.actual)}</td>
                    <td className={cn(td, m.variance < 0 ? "text-red-700" : m.variance > 0 ? "text-green-700" : "")}>{fmtMcSigned(m.variance)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </QuestionCard>

      {s.clearance && (
        <QuestionCard question="How fast is customs clearing?" hint="Batches produced in the period: cleared vs still pending">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Clearance rate</div>
              <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtPct(s.clearance.clearanceRatePct)}</div>
              <div className="text-xs text-muted-foreground">{fmtMc(s.clearance.clearedMc)} cleared · {fmtMc(s.clearance.pendingMc)} pending</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Days to clear</div>
              <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{s.clearance.avgDaysToClear === null ? "–" : Math.round(s.clearance.avgDaysToClear)}</div>
              <div className="text-xs text-muted-foreground">average · median {s.clearance.medianDaysToClear === null ? "–" : Math.round(s.clearance.medianDaysToClear)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Oldest pending</div>
              {s.clearance.oldestPending ? (
                <>
                  <div className="font-semibold">{s.clearance.oldestPending.sku}</div>
                  <div className="text-xs text-muted-foreground">{s.clearance.oldestPending.productionPeriod} · {fmtMc(s.clearance.oldestPending.pendingMc)} {unitLabel}{s.clearance.oldestPending.daysWaiting !== null ? ` · waiting ${s.clearance.oldestPending.daysWaiting} days` : ""}</div>
                </>
              ) : <div className="text-sm text-muted-foreground">Nothing pending</div>}
            </div>
          </div>
          {s.clearance.batchStatus.length > 0 && (
            <table className="mt-4 w-full">
              <thead><tr>{["Batch status", "Batches", unitLabel].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{s.clearance.batchStatus.map((b) => <tr className="border-t" key={b.status}><td className={td}>{b.status}</td><td className={td}>{b.batches}</td><td className={td}>{fmtMc(b.mc)}</td></tr>)}</tbody>
            </table>
          )}
        </QuestionCard>
      )}

      <SectionNotes notes={s.notes} />
    </div>
  );
}
