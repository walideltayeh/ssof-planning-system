import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import type { SectionProps, VolumeBridge } from "./types";

type BridgeStep = VolumeBridge["steps"][number];
import {
  EmptyState, PERF_COLORS, QuestionCard, SectionNotes, Sparkline, usePerfFormat,
} from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

/** Floating-bar layout for the LY → TY volume bridge. */
function bridgeData(steps: BridgeStep[]) {
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

export default function DemandSection({ pack, presentation }: SectionProps) {
  const d = pack.demand;
  const { fmtMc, fmtMcSigned, fmtPct, fmtPctSigned, axisMc, unitLabel } = usePerfFormat();
  const [showPareto, setShowPareto] = useState(false);
  const chartH = presentation ? 360 : 320;
  const lastYear = d.monthly.some((x) => x.lastYear !== null);
  const yoyAvailable = d.yoy.some((x) => x.lastYear !== null);
  const seasonYears = Math.max(0, ...d.seasonality.map((x) => x.yearsUsed));
  const moversLimit = presentation ? 8 : 15;

  const QuantityTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    return <div className="rounded border bg-white p-2 text-xs shadow">
      <div className="font-medium">{label}</div>
      {payload.map((p: any) => <div key={p.dataKey} style={{ color: p.color }}>{p.name}: {fmtMc(p.value)}</div>)}
      {row?.autoFilled && <div className="mt-1 text-muted-foreground">Sell-out auto-filled from forecast</div>}
    </div>;
  };

  const BridgeTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as ReturnType<typeof bridgeData>[number];
    return <div className="rounded border bg-white p-2 text-xs shadow">
      <div className="font-medium">{row.label}</div>
      <div>{row.kind === "total" ? fmtMc(row.value) : fmtMcSigned(row.value)} {unitLabel}</div>
      {row.detail && <div className="mt-1 max-w-64 whitespace-normal text-muted-foreground">{row.detail}</div>}
    </div>;
  };

  const moverTable = (rows: typeof d.growers, positive: boolean) => (
    <div className="overflow-x-auto">
      <div className={`mb-2 font-semibold ${positive ? "text-green-700" : "text-red-700"}`}>{positive ? "Growing" : "Declining"}</div>
      <table className="w-full"><thead><tr>
        {["SKU", "Weight", "Current", "Reference", `Change (${unitLabel})`, "Change"].map((x) => <th className={th} key={x}>{x}</th>)}
      </tr></thead><tbody>{rows.slice(0, moversLimit).map((r) => <tr className="border-t" key={`${r.sku}-${r.weight}`}>
        <td className={td}>{r.sku}</td><td className={td}>{r.weight}</td><td className={td}>{fmtMc(r.current)}</td>
        <td className={td}>{fmtMc(r.reference)}</td><td className={td}>{fmtMcSigned(r.deltaMc)}</td>
        <td className={`${td} ${r.deltaPct === null ? "text-muted-foreground" : r.deltaPct >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtPctSigned(r.deltaPct)}</td>
      </tr>)}</tbody></table>
    </div>
  );

  return <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
    <QuestionCard question="Are we selling what we planned, and more than last year?">
      <ResponsiveContainer width="100%" height={chartH}>
        <ComposedChart data={d.monthly}>
          <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} label={{ value: unitLabel, angle: -90, position: "insideLeft" }} />
          <Tooltip content={<QuantityTooltip />} /><Legend />
          <Bar dataKey="ims" name="Sell-out" fill={PERF_COLORS.accent}>{d.monthly.map((x) => <Cell key={x.label} fill={x.autoFilled ? PERF_COLORS.accentSoft : PERF_COLORS.accent} fillOpacity={x.autoFilled ? 0.55 : 1} />)}</Bar>
          <Line dataKey="plan" name="Plan" stroke={PERF_COLORS.plan} strokeDasharray="5 4" dot={false} />
          {lastYear && <Line dataKey="lastYear" name="Last year" stroke={PERF_COLORS.lastYear} dot={false} />}
          <Line dataKey="runningRate3" name="3-month average" stroke={PERF_COLORS.neutral} strokeWidth={1} dot={false} />
          <Line dataKey="runningRate6" name="6-month average" stroke="#6b7280" strokeWidth={1} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {!lastYear && <p className="text-sm text-muted-foreground">No prior year data</p>}
    </QuestionCard>

    <QuestionCard question={`How did we get from ${d.bridge.fromLabel} to ${d.bridge.toLabel}?`} hint="Volume bridge: same-SKU growth, new launches and lost or inactive lines">
      {!d.bridge.available ? <EmptyState message={d.bridge.note} /> : <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={bridgeData(d.bridge.steps)} margin={{ left: 8, right: 8 }}>
            <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" interval={0} tick={{ fontSize: 11 }} /><YAxis tickFormatter={axisMc} />
            <Tooltip content={<BridgeTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="base" stackId="b" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="height" stackId="b" isAnimationActive={false}>{bridgeData(d.bridge.steps).map((x) => <Cell key={x.key} fill={x.fill} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="overflow-x-auto">
          <table className="w-full"><thead><tr>{["Step", unitLabel, "Detail"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
            <tbody>{d.bridge.steps.map((st) => <tr className={`border-t ${st.kind === "total" ? "font-semibold" : ""}`} key={st.key}><td className={td}>{st.label}</td><td className={`${td} ${st.kind === "delta" ? (st.value >= 0 ? "text-green-700" : "text-red-700") : ""}`}>{st.kind === "total" ? fmtMc(st.value) : fmtMcSigned(st.value)}</td><td className={`${td} text-xs text-muted-foreground`}>{st.detail ?? ""}</td></tr>)}</tbody></table>
          {d.bridge.byWeight.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{d.bridge.byWeight.map((w) => <span key={w.key} className={`rounded border px-2 py-1 text-xs ${w.value >= 0 ? "text-green-700" : "text-red-700"}`} title={w.detail}>{w.label}: {fmtMcSigned(w.value)}</span>)}</div>}
          <p className="mt-2 text-xs text-muted-foreground">{d.bridge.note}</p>
        </div>
      </div>}
    </QuestionCard>

    <div className="grid gap-4 md:grid-cols-2">
      <QuestionCard question="How does each month compare with last year?">
        {!yoyAvailable ? <EmptyState message="No prior year data" /> : <>
          <div className={`${presentation ? "text-2xl" : "text-xl"} mb-3 font-bold`}>
            Year to date: {fmtPctSigned(d.yoy.at(-1)?.cumulativeGrowthPct)} vs last year
          </div>
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart data={d.yoy}><CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={axisMc} />
              <Tooltip formatter={(v: number) => fmtMc(v)} /><Legend /><Bar dataKey="current" name="Current" fill={PERF_COLORS.accent} />
              <Bar dataKey="lastYear" name="Last year" fill={PERF_COLORS.lastYear} /></BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-2">{d.yoy.map((x) => <span className="rounded bg-muted px-2 py-1 text-xs" key={x.label}>{x.label}: {fmtPctSigned(x.growthPct)}</span>)}</div>
          <p className="mt-2 text-xs text-muted-foreground">Cumulative sell-out: {fmtMc(d.yoy.at(-1)?.cumulativeCurrent)} vs {fmtMc(d.yoy.at(-1)?.cumulativeLastYear)} last year</p>
        </>}
      </QuestionCard>
      <QuestionCard question="Which months are naturally strong or weak?" hint={`Index built from ${seasonYears} years; 1.0 is an average month`}>
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={d.seasonality}><CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" /><YAxis />
            <Tooltip formatter={(v: number) => v.toFixed(2)} /><ReferenceLine y={1} stroke={PERF_COLORS.neutral} strokeDasharray="4 4" />
            <Bar dataKey="index" name="Seasonality index" fill={PERF_COLORS.accentSoft}>{d.seasonality.map((x) => <Cell key={x.label} fill={x.tag ? PERF_COLORS.warning : PERF_COLORS.accentSoft} />)}</Bar></BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-2">{d.seasonality.filter((x) => x.tag).map((x) => <span className="rounded border px-2 py-1 text-xs" key={x.label}>{x.label}: {x.tag}</span>)}</div>
      </QuestionCard>
    </div>

    <QuestionCard question="What is our mix, and how is it shifting?">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{d.mix.map((dimension) => <div className="overflow-x-auto" key={dimension.dimension}>
        <h3 className="mb-1 font-semibold">{dimension.title}</h3><table className="w-full"><thead><tr>{["Group", unitLabel, "Share", "Last year", "Shift"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
        <tbody>{dimension.rows.slice(0, presentation ? 8 : undefined).map((r) => <tr className="border-t" key={r.group}><td className={td}>{r.group}</td><td className={td}>{fmtMc(r.mc)}</td><td className={td}>{fmtPct(r.sharePct)}</td><td className={td}>{fmtPct(r.lastYearSharePct)}</td><td className={`${td} ${(r.shiftPts ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtPctSigned(r.shiftPts)}</td></tr>)}</tbody></table>
        {presentation && dimension.rows.length > 8 && <p className="text-xs text-muted-foreground">+{dimension.rows.length - 8} more in the full pack</p>}
      </div>)}</div>
    </QuestionCard>

    <QuestionCard question="Which SKUs make up 80% of sell-out?" actions={!presentation && d.pareto.length > 15 ? <Button variant="outline" size="sm" onClick={() => setShowPareto(!showPareto)}>{showPareto ? "Show less" : "Show all"}</Button> : null}>
      <ResponsiveContainer width="100%" height={chartH}>
        <ComposedChart data={d.pareto.slice(0, presentation ? 8 : showPareto ? undefined : 15)}><CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="sku" interval={0} angle={-25} textAnchor="end" height={70} /><YAxis yAxisId="mc" tickFormatter={axisMc} /><YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip formatter={(v: number, name: string) => name === "Cumulative share" ? fmtPct(v) : fmtMc(v)} /><Bar yAxisId="mc" dataKey="mc" name="Sell-out" fill={PERF_COLORS.accent}>{d.pareto.slice(0, presentation ? 8 : showPareto ? undefined : 15).map((x) => <Cell key={x.sku} fill={x.inTop80 ? PERF_COLORS.accent : PERF_COLORS.plan} />)}</Bar><Line yAxisId="pct" dataKey="cumulativePct" name="Cumulative share" stroke={PERF_COLORS.neutral} dot={false} /><ReferenceLine yAxisId="pct" y={80} stroke={PERF_COLORS.positive} strokeDasharray="4 4" /></ComposedChart>
      </ResponsiveContainer>
      <p className="text-sm text-muted-foreground">{d.pareto.filter((x) => x.inTop80).length} of {d.pareto.length} SKUs make 80% of volume</p>
    </QuestionCard>

    <QuestionCard question="Who is growing and who is declining?" hint={d.moversBasis === "ly" ? "Compared with last year" : "Compared with the previous period"}>
      <div className="grid gap-5 md:grid-cols-2">{moverTable(d.growers, true)}{moverTable(d.decliners, false)}</div>
    </QuestionCard>

    <QuestionCard question="How much of our sell-out comes from new products (NPI) and how fast are they ramping?">
      {!d.npi.ramps.length ? <EmptyState message="No NPI SKUs in this country" /> : <>
        <div className="mb-4 grid grid-cols-2 gap-3"><div><div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{fmtPct(d.npi.coreSharePct)}</div><div className="text-sm text-muted-foreground">Core products</div></div><div><div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{fmtPct(d.npi.npiSharePct)}</div><div className="text-sm text-muted-foreground">New products</div></div></div>
        <ResponsiveContainer width="100%" height={presentation ? 320 : 220}><BarChart data={d.npi.byMonth}><XAxis dataKey="label" /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} /><Tooltip formatter={(v: number) => fmtPct(v)} /><Legend /><Bar stackId="share" dataKey="corePct" name="Core products" fill={PERF_COLORS.plan} /><Bar stackId="share" dataKey="npiPct" name="New products" fill={PERF_COLORS.accent} /></BarChart></ResponsiveContainer>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["SKU", "Weight", "Launch month", "Months since launch", "Ramp", `Total (${unitLabel})`].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead><tbody>{d.npi.ramps.slice(0, presentation ? 8 : undefined).map((r) => <tr className="border-t" key={r.sku}><td className={td}>{r.sku}</td><td className={td}>{r.weight}</td><td className={td}>{r.launchMonth ?? "–"}</td><td className={td}>{r.monthsSinceLaunch}</td><td className={td}><Sparkline points={r.ramp} /></td><td className={td}>{fmtMc(r.totalMc)}</td></tr>)}</tbody></table></div>
      </>}
    </QuestionCard>
    <SectionNotes notes={d.notes} />
  </div>;
}