import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import type { Rag } from "./types";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, RagDot, SectionNotes, usePerfFormat } from "./shared";

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";
const accuracyRag = (v: number | null): Rag => v === null ? "grey" : v >= 85 ? "green" : v >= 70 ? "amber" : "red";

export default function ForecastQualitySection({ pack, presentation }: SectionProps) {
  const q = pack.forecastQuality;
  const { fmtMc, fmtPct, fmtPctSigned, axisMc, unitLabel } = usePerfFormat();
  const [showAll, setShowAll] = useState(false);
  const skuRows = [...q.bySku].sort((a, b) => (a.accuracyPct ?? -1) - (b.accuracyPct ?? -1));
  const limit = presentation ? 8 : showAll ? skuRows.length : 15;
  const groupTable = (rows: typeof q.byWeight, sku = false) => <div className="overflow-x-auto"><table className="w-full"><thead><tr>
    {(sku ? ["SKU", "Weight"] : ["Weight"]).concat([`Forecast (${unitLabel})`, `Actual (${unitLabel})`, "Accuracy", "Bias", "Months"]).map((x) => <th className={th} key={x}>{x}</th>)}
  </tr></thead><tbody>{rows.map((r) => <tr className="border-t" key={`${r.group}-${r.weight ?? ""}`}><td className={td}>{r.group}</td>{sku && <td className={td}>{r.weight ?? "–"}</td>}<td className={td}>{fmtMc(r.forecast)}</td><td className={td}>{fmtMc(r.actual)}</td><td className={td}><span className="inline-flex items-center gap-2"><RagDot status={accuracyRag(r.accuracyPct)} />{fmtPct(r.accuracyPct)}</span></td><td className={td}>{fmtPctSigned(r.biasPct)}</td><td className={td}>{r.monthsMeasured}</td></tr>)}</tbody></table></div>;

  return <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
    <div className="grid gap-4 md:grid-cols-2">
      <QuestionCard question="How accurate is our forecast?"><div className="flex items-center gap-3"><RagDot status={accuracyRag(q.overallAccuracyPct)} className="h-4 w-4" /><strong className={presentation ? "text-3xl" : "text-2xl"}>{fmtPct(q.overallAccuracyPct)}</strong></div></QuestionCard>
      <QuestionCard question="Do we over- or under-forecast?"><strong className={presentation ? "text-3xl" : "text-2xl"}>{fmtPctSigned(q.overallBiasPct)}</strong><p className="mt-1 text-sm text-muted-foreground">{q.overallBiasPct === null ? "Direction not available" : q.overallBiasPct >= 0 ? "We are over-forecasting" : "We are under-forecasting"}</p></QuestionCard>
    </div>
    <p className="text-xs text-muted-foreground">{q.method} · {q.excludedAutoFilledMonths} auto-filled months excluded</p>
    <QuestionCard question="How has accuracy moved month by month?">
      <ResponsiveContainer width="100%" height={presentation ? 380 : 320}><ComposedChart data={q.byMonth}><CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis yAxisId="mc" tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} /><YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${v}%`} /><Tooltip formatter={(v: number, name: string) => name.includes("%") ? fmtPct(v) : fmtMc(v)} /><Legend /><Bar yAxisId="mc" dataKey="forecast" name="Forecast" fill={PERF_COLORS.plan} /><Bar yAxisId="mc" dataKey="actual" name="Actual" fill={PERF_COLORS.accent} /><Line yAxisId="pct" dataKey="accuracyPct" name="Accuracy %" stroke={PERF_COLORS.positive} /><Line yAxisId="pct" dataKey="biasPct" name="Bias %" stroke={PERF_COLORS.negative} strokeDasharray="4 4" /><ReferenceLine yAxisId="pct" y={0} stroke={PERF_COLORS.neutral} /></ComposedChart></ResponsiveContainer>
    </QuestionCard>
    <QuestionCard question="Which weights are hardest to forecast?">{groupTable(q.byWeight)}</QuestionCard>
    <QuestionCard question="Which SKUs need a forecast review?" actions={!presentation && skuRows.length > 15 ? <Button size="sm" variant="outline" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 15" : "Show all"}</Button> : null}>
      {groupTable(skuRows.slice(0, limit), true)}
      {presentation && skuRows.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{skuRows.length - 8} more in the full pack</p>}
    </QuestionCard>
    <QuestionCard question="Where is the forecast consistently wrong?">
      {!q.chronic.length ? <EmptyState message="No SKU has been biased the same way for 3+ consecutive months" /> : <ul className="divide-y">{q.chronic.map((r) => <li className="py-3 text-sm" key={`${r.sku}-${r.weight}`}><strong>{r.sku}</strong> ({r.weight}): {r.direction === "over" ? "over-forecast" : "under-forecast"} for {r.consecutiveMonths} months in a row (average {fmtPctSigned(r.avgBiasPct)})</li>)}</ul>}
    </QuestionCard>
    <SectionNotes notes={q.notes} />
  </div>;
}