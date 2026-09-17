import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { GapRow, SectionProps } from "./types";
import { PERF_COLORS, QuestionCard, SectionNotes, usePerfFormat } from "./shared";
import { useScenario } from "./useScenario";

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";

export default function ForwardSection({ pack, presentation }: SectionProps) {
  const f = pack.forward;
  const [scenarioPct, setScenarioPct] = useState(0);
  const [filter, setFilter] = useState<"all" | "add" | "cut">("all");
  const scenario = useScenario(f.inputs, 1 + scenarioPct / 100);
  const { fmtMc, fmtMcSigned, fmtWeeks, axisMc, unitLabel } = usePerfFormat();
  const total = scenarioPct === 0 ? f.total : scenario.total;
  const byWeight = scenarioPct === 0 ? f.byWeight : scenario.byWeight;
  const gaps = scenarioPct === 0 ? f.gaps : scenario.gaps;
  const chartData = (rows: typeof total) => rows.map((r) => ({ ...r, targetBase: r.targetLowMc, targetBand: Math.max(0, r.targetHighMc - r.targetLowMc) }));
  const filtered = useMemo(() => gaps.filter((r) => filter === "all" || r.action === filter).sort((a, b) => Math.abs(b.gapMc) - Math.abs(a.gapMc)), [gaps, filter]);
  const shown = presentation ? filtered.slice(0, 8) : filtered;
  const totalAdd = gaps.filter((r) => r.action === "add").reduce((s, r) => s + Math.abs(r.gapMc), 0);
  const totalCut = gaps.filter((r) => r.action === "cut").reduce((s, r) => s + Math.abs(r.gapMc), 0);

  const StockChart = ({ rows, height }: { rows: typeof total; height: number }) => <ResponsiveContainer width="100%" height={height}>
    <ComposedChart data={chartData(rows)}><CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
      <Tooltip formatter={(v: number, name: string, item: any) => {
        if (name === "Target base") return [fmtMc(v), "Target minimum"];
        if (name === "Target band") return [`${fmtMc(item.payload.targetLowMc)} – ${fmtMc(item.payload.targetHighMc)}`, "Target range"];
        const weeks = name === "Closing stock" ? ` (${fmtWeeks(item.payload.weeks)})` : "";
        return [`${fmtMc(v)}${weeks}`, name];
      }} />
      <Legend /><Area stackId="target" dataKey="targetBase" name="Target base" stroke="transparent" fill="transparent" legendType="none" />
      <Area stackId="target" dataKey="targetBand" name="Target band" stroke={PERF_COLORS.positive} fill={PERF_COLORS.band} />
      <Bar dataKey="arrivals" name="Arrivals" fill={PERF_COLORS.plan} /><Line dataKey="demand" name="Demand" stroke={PERF_COLORS.neutral} strokeDasharray="5 4" dot={false} />
      <Line dataKey="closing" name="Closing stock" stroke={PERF_COLORS.accent} strokeWidth={3} dot={false} />
    </ComposedChart>
  </ResponsiveContainer>;

  const actionBadge = (row: GapRow) => {
    const style = row.action === "add" ? "border-red-200 bg-red-50 text-red-700" : row.action === "cut" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-gray-200 bg-gray-50 text-gray-600";
    return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>{row.action === "add" ? "Add" : row.action === "cut" ? "Cut" : "Hold"}</span>;
  };

  return <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="font-semibold">Demand scenario: {scenarioPct > 0 ? "+" : ""}{scenarioPct}% vs plan</div><div className="text-xs text-muted-foreground">{f.inputs.leadTimeNote} · Target: {f.inputs.target.low.toFixed(1)}–{f.inputs.target.high.toFixed(1)} weeks of cover</div></div>
        <Button variant="outline" size="sm" onClick={() => setScenarioPct(0)} disabled={scenarioPct === 0}>Reset</Button>
      </div>
      <Slider className="mt-4" min={-20} max={20} step={5} value={[scenarioPct]} onValueChange={(v) => setScenarioPct(v[0] ?? 0)} aria-label="Demand scenario percentage" />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>−20%</span><span>Plan</span><span>+20%</span></div>
    </div>
    <QuestionCard question="Where will stock land over the next 6 months?">{StockChart({ rows: total, height: presentation ? 420 : 340 })}</QuestionCard>
    <QuestionCard question="Which weights need attention?">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{byWeight.map((w) => <div className="rounded-md border p-2" key={w.weight}><h3 className="px-2 pt-1 font-semibold">{w.weight}</h3>{StockChart({ rows: w.months, height: presentation ? 320 : 230 })}</div>)}</div>
    </QuestionCard>
    <QuestionCard question="What should we add or cut, and by when?" actions={<div className="flex gap-1">{(["all", "add", "cut"] as const).map((x) => <Button key={x} size="sm" variant={filter === x ? "default" : "outline"} onClick={() => setFilter(x)}>{x === "all" ? "All" : x === "add" ? "Add" : "Cut"}</Button>)}</div>}>
      <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["SKU", "Weight", "Horizon month", `Projected closing (${unitLabel})`, `Target closing (${unitLabel})`, `Gap (${unitLabel})`, "Action", "Order by"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
        <tbody>{shown.map((r) => <tr className="border-t" key={`${r.sku}-${r.weight}`}><td className={td}>{r.sku}</td><td className={td}>{r.weight}</td><td className={td}>{r.horizonMonth}</td><td className={td}>{fmtMc(r.projectedClosing)}</td><td className={td}>{fmtMc(r.targetClosing)}</td><td className={td}>{fmtMcSigned(r.gapMc)}</td><td className={td}>{actionBadge(r)}</td><td className={td}>{r.orderByMonth ?? "–"}</td></tr>)}</tbody>
        <tfoot><tr className="border-t-2 font-semibold"><td className={td} colSpan={5}>Total action</td><td className={td} colSpan={3}>Add {fmtMc(totalAdd)} · Cut {fmtMc(totalCut)}</td></tr></tfoot>
      </table></div>
      {presentation && filtered.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{filtered.length - 8} more in the full pack</p>}
    </QuestionCard>
    <SectionNotes notes={f.notes} />
  </div>;
}