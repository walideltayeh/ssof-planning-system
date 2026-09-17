import { useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Settings2 } from "lucide-react";
import { usePerformanceContext } from "./PerformanceContext";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, RagBadge, SectionNotes, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";
const NONE = "__none__";

export default function OutlookSection({ pack, presentation }: SectionProps) {
  const o = pack.outlook;
  const { fmtMc, fmtMcSigned, fmtPctSigned, axisMc, unitLabel } = usePerfFormat();
  const groups = [o.total, ...o.byWeight, ...o.byType];
  const gapColour = (v: number | null) => (v === null ? "text-muted-foreground" : v >= 0 ? "text-green-700" : "text-red-700");

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
        <p className={cn("font-medium", presentation ? "text-2xl" : "text-lg")}>{o.message}</p>
        <p className="mt-1 text-sm text-muted-foreground">{o.baseline.note}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <QuestionCard question="Landing estimate" hint={`Actual to ${o.ytdThrough ?? "date"} + forecast for the rest of ${o.year}`}>
          <div className="flex items-start justify-between gap-2">
            <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(o.total.landing)}</div>
            <RagBadge status={o.total.status} />
          </div>
          <div className="text-xs text-muted-foreground">{unitLabel} full year</div>
        </QuestionCard>
        <QuestionCard question="Annual plan" hint={o.baseline.label}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(o.total.annualPlan)}</div>
          <div className={cn("text-sm", gapColour(o.total.gapMc))}>{fmtMcSigned(o.total.gapMc)} ({fmtPctSigned(o.total.gapPct)}) gap</div>
        </QuestionCard>
        <QuestionCard question="Required run rate" hint={`(Plan − actual to date) ÷ ${o.monthsRemaining} month${o.monthsRemaining === 1 ? "" : "s"} remaining`}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(o.total.requiredRate)}</div>
          <div className="text-xs text-muted-foreground">{unitLabel} / month needed</div>
        </QuestionCard>
        <QuestionCard question="Current run rate" hint={`Latest actual month (${o.ytdThrough ?? "n/a"})`}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtMc(o.total.currentRate)}</div>
          <div className={cn("text-sm", o.total.stretchPct === null ? "text-muted-foreground" : o.total.stretchPct > 0 ? "text-red-700" : "text-green-700")}>
            {o.total.stretchPct === null ? "No stretch measurable" : o.total.stretchPct > 0 ? `${o.total.stretchPct.toFixed(1)}% stretch needed` : `${Math.abs(o.total.stretchPct).toFixed(1)}% cushion`}
          </div>
        </QuestionCard>
      </div>

      <QuestionCard question={`How does ${o.year} build up month by month?`} hint="Bars: actual then forecast · line: cumulative landing vs cumulative plan">
        {o.monthly.length === 0 ? (
          <EmptyState message={`No ${o.year} months in the planning horizon`} />
        ) : (
          <ResponsiveContainer width="100%" height={presentation ? 360 : 320}>
            <ComposedChart data={o.monthly.map((m) => ({ ...m, actualBar: m.actual, forecastBar: m.actual === null ? m.forecast : null }))}>
              <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" />
              <YAxis yAxisId="m" tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
              <YAxis yAxisId="c" orientation="right" tickFormatter={axisMc} />
              <Tooltip content={<ChartTooltip />} /><Legend />
              <Bar yAxisId="m" dataKey="actualBar" name="Actual IMS" fill={PERF_COLORS.accent} stackId="m" />
              <Bar yAxisId="m" dataKey="forecastBar" name="Forecast" fill={PERF_COLORS.accent} fillOpacity={0.35} stackId="m" />
              <Line yAxisId="m" dataKey="plan" name="Monthly plan" stroke={PERF_COLORS.plan} strokeDasharray="5 4" dot={false} />
              <Area yAxisId="c" dataKey="cumulativeLanding" name="Cumulative landing" stroke={PERF_COLORS.neutral} fill={PERF_COLORS.neutral} fillOpacity={0.06} />
              <Line yAxisId="c" dataKey="cumulativePlan" name="Cumulative plan" stroke={PERF_COLORS.warning} strokeDasharray="3 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </QuestionCard>

      <QuestionCard question="Where will each part of the range land?" actions={!presentation ? <BaselinePicker country={pack.meta.country} year={o.year} /> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>{["Group", "SKUs", "Actual to date", "Remaining forecast", "Landing", "Annual plan", "Gap", "Gap %", "Required / month", "Current / month", "Stretch", "Status"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
            <tbody>
              {groups.map((g, i) => (
                <tr className={cn("border-t", i === 0 && "bg-muted/40 font-semibold")} key={g.group}>
                  <td className={td}>{g.group}</td><td className={td}>{g.skuCount}</td><td className={td}>{fmtMc(g.ytdActual)}</td><td className={td}>{fmtMc(g.remainingForecast)}</td>
                  <td className={td}>{fmtMc(g.landing)}</td><td className={td}>{fmtMc(g.annualPlan)}</td>
                  <td className={cn(td, gapColour(g.gapMc))}>{fmtMcSigned(g.gapMc)}</td><td className={cn(td, gapColour(g.gapPct))}>{fmtPctSigned(g.gapPct)}</td>
                  <td className={td}>{fmtMc(g.requiredRate)}</td><td className={td}>{fmtMc(g.currentRate)}</td>
                  <td className={cn(td, g.stretchPct === null ? "text-muted-foreground" : g.stretchPct > 0 ? "text-red-700" : "text-green-700")}>{g.stretchPct === null ? "–" : `${g.stretchPct > 0 ? "+" : ""}${g.stretchPct.toFixed(1)}%`}</td>
                  <td className={td}><RagBadge status={g.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QuestionCard>

      <SectionNotes notes={o.notes} />
    </div>
  );
}

/** Admin control: choose which saved version is the board-approved annual plan for this country + year. */
function BaselinePicker({ country, year }: { country: SectionProps["pack"]["meta"]["country"]; year: number }) {
  const ctx = usePerformanceContext();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const query = trpc.country.boardPlanBaseline.useQuery({ country, year }, { enabled: open });
  const mutation = trpc.country.setBoardPlanBaseline.useMutation({
    onSuccess: () => {
      void utils.country.boardPlanBaseline.invalidate({ country, year });
      void utils.country.performance.invalidate();
    },
  });
  if (!ctx?.canEdit) return null;
  if (!open) return <Button variant="ghost" size="sm" className="perf-no-print" onClick={() => setOpen(true)}><Settings2 />Choose budget version</Button>;
  const versions = query.data?.versions ?? [];
  const current = query.data?.versionId ?? null;
  return (
    <div className="perf-no-print flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Budget {year}:</span>
      <Select
        value={current === null ? NONE : String(current)}
        onValueChange={(value) => mutation.mutate({ country, year, versionId: value === NONE ? null : Number(value) })}
        disabled={query.isLoading || mutation.isPending}
      >
        <SelectTrigger size="sm" className="min-w-56"><SelectValue placeholder="Loading versions…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Current forecast (no approved budget)</SelectItem>
          {versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name} — {new Date(v.createdAt).toLocaleDateString()} by {v.savedBy}</SelectItem>)}
        </SelectContent>
      </Select>
      {query.data?.setBy && <span className="text-xs text-muted-foreground">set by {query.data.setBy}</span>}
      {mutation.error && <span className="text-xs text-red-700">{mutation.error.message}</span>}
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Done</Button>
    </div>
  );
}
