import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { SectionProps, WaterfallStep } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, SectionNotes, Sparkline, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

/** Turns total/delta steps into floating bars (invisible base + visible height). */
function waterfallData(steps: WaterfallStep[]) {
  let level = 0;
  return steps.map((step) => {
    if (step.kind === "total") {
      level = step.value;
      return { ...step, base: Math.min(0, step.value), height: Math.abs(step.value), fill: PERF_COLORS.neutral };
    }
    const start = level;
    level += step.value;
    return { ...step, base: Math.min(start, level), height: Math.abs(step.value), fill: step.value >= 0 ? PERF_COLORS.positive : PERF_COLORS.negative };
  });
}

export default function FlowSection({ pack, presentation }: SectionProps) {
  const f = pack.flow;
  const { fmtMc, fmtMcSigned, fmtPctSigned, fmtWeeks, axisMc, unitLabel } = usePerfFormat();
  const chartH = presentation ? 320 : 280;

  const Waterfall = ({ steps, question, hint }: { steps: WaterfallStep[]; question: string; hint: string }) => {
    const data = waterfallData(steps);
    const WfTooltip = ({ active, payload }: any) => {
      if (!active || !payload?.length) return null;
      const row = payload[0].payload as ReturnType<typeof waterfallData>[number];
      return (
        <div className="rounded border bg-white p-2 text-xs shadow">
          <div className="font-medium">{row.label}</div>
          <div>{row.kind === "total" ? fmtMc(row.value) : fmtMcSigned(row.value)} {unitLabel}</div>
          {row.gapPct !== null && <div className="text-muted-foreground">{fmtPctSigned(row.gapPct)} vs previous step</div>}
          {row.note && <div className="mt-1 max-w-64 whitespace-normal text-muted-foreground">{row.note}</div>}
        </div>
      );
    };
    return (
      <QuestionCard question={question} hint={hint}>
        {steps.length === 0 ? (
          <EmptyState message="No data for this period" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={data} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
                <Tooltip content={<WfTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="height" stackId="w" isAnimationActive={false}>{data.map((d) => <Cell key={d.key} fill={d.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {steps.map((s) => (
                <span key={s.key} className={cn(s.kind === "total" ? "font-semibold" : s.value >= 0 ? "text-green-700" : "text-red-700")} title={s.note}>
                  {s.label}: {s.kind === "total" ? fmtMc(s.value) : fmtMcSigned(s.value)}{s.gapPct !== null && s.kind === "delta" ? ` (${fmtPctSigned(s.gapPct)})` : ""}
                </span>
              ))}
            </div>
          </>
        )}
      </QuestionCard>
    );
  };

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <QuestionCard question="Where is the stock right now?" hint="Each stage of the chain, in quantity and in weeks of sell-out cover">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {f.pipeline.map((stage, i) => (
            <div key={stage.key} className="relative rounded-lg border p-3">
              {i < f.pipeline.length - 1 && <span className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-muted-foreground xl:block">›</span>}
              <div className="text-xs font-medium text-muted-foreground">{stage.label}</div>
              <div className={cn("mt-1 font-bold", presentation ? "text-2xl" : "text-xl")}>{stage.mc === null ? "–" : fmtMc(stage.mc)}</div>
              <div className="text-xs text-muted-foreground">{stage.mc === null ? "not tracked" : `${fmtWeeks(stage.weeksOfCover)} of cover`}</div>
              {stage.note && <div className="mt-1 text-[11px] text-muted-foreground">{stage.note}</div>}
            </div>
          ))}
        </div>
      </QuestionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Waterfall steps={f.waterfall.supply} question="How much of the plan reached the market?" hint={pack.meta.isIntl ? "Plan → produced → cleared → still in the pipeline" : "Plan → produced → arrived"} />
        <Waterfall steps={f.waterfall.stock} question="What moved the stock level?" hint="Opening stock + what came in − what sold = closing stock (reconciles with Planning)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuestionCard question="How long does each leg take?" hint="Average, fastest and slowest, with the trend over recent batches">
          {f.leadTimes.length === 0 ? (
            <EmptyState message="No lead-time data for this country" />
          ) : (
            <table className="w-full">
              <thead><tr>{["Leg", "Average", "Range", "Batches", "Trend"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>
                {f.leadTimes.map((lt) => (
                  <tr className="border-t" key={lt.label}>
                    <td className={cn(td, "font-medium")}>{lt.label}{lt.note && <span className="block text-[11px] font-normal text-muted-foreground">{lt.note}</span>}</td>
                    <td className={td}>{lt.avgDays === null ? "–" : `${Math.round(lt.avgDays)} days`}</td>
                    <td className={td}>{lt.minDays === null || lt.maxDays === null ? "–" : `${Math.round(lt.minDays)}–${Math.round(lt.maxDays)} days`}</td>
                    <td className={td}>{lt.sampleSize}</td>
                    <td className={td}><Sparkline points={lt.trend} width={100} height={24} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QuestionCard>

        <QuestionCard question="Which batches are stuck?" hint="Production that has not fully arrived, oldest first">
          {f.delayedBatches.length === 0 ? (
            <EmptyState message="Nothing is overdue" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["SKU", "Produced", `Pending (${unitLabel})`, "Expected", "Days late", "Status", "Reference"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                <tbody>
                  {f.delayedBatches.slice(0, presentation ? 8 : 25).map((b, i) => (
                    <tr className="border-t" key={`${b.sku}-${b.productionPeriod}-${i}`}>
                      <td className={td}>{b.sku}<span className="block text-xs text-muted-foreground">{b.weight}</span></td>
                      <td className={td}>{b.productionPeriod}</td>
                      <td className={td}>{fmtMc(b.pendingMc)}<span className="block text-xs text-muted-foreground">of {fmtMc(b.producedMc)}</span></td>
                      <td className={td}>{b.expectedArrival ?? "–"}</td>
                      <td className={cn(td, b.daysLate !== null && b.daysLate > 0 ? "text-red-700" : "")}>{b.daysLate === null ? "–" : b.daysLate}</td>
                      <td className={td}>{b.status}</td>
                      <td className={cn(td, "text-xs text-muted-foreground")}>{[b.invoiceRef, b.containerRef].filter(Boolean).join(" / ") || "–"}{b.note && <span className="block">{b.note}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.delayedBatches.length > (presentation ? 8 : 25) && <p className="mt-2 text-xs text-muted-foreground">+{f.delayedBatches.length - (presentation ? 8 : 25)} more in the Excel export</p>}
            </div>
          )}
        </QuestionCard>
      </div>

      <SectionNotes notes={f.notes} />
    </div>
  );
}
