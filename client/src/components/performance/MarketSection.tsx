import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, PERF_COLORS, QuestionCard, SectionNotes, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

export default function MarketSection({ pack, presentation }: SectionProps) {
  const mk = pack.market;
  const { fmtPct, fmtPctSigned } = usePerfFormat();
  if (!mk) return <EmptyState message="No competitor data has been uploaded for this country" />;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString("en-US"));
  const pts = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pts`);
  const tone = (v: number | null) => (v === null ? "text-muted-foreground" : v >= 0 ? "text-green-700" : "text-red-700");

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <div className={cn("rounded-xl border-l-8 border-[#7f1d1d] bg-[#7f1d1d]/5 p-4", presentation && "p-6")}>
        <p className={cn("font-medium", presentation ? "text-2xl" : "text-lg")}>{mk.message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Competitor sheet for {mk.year}, {mk.monthsCovered} month{mk.monthsCovered === 1 ? "" : "s"} · figures in {mk.unit}
          {mk.source.uploadedAt ? ` · uploaded ${new Date(mk.source.uploadedAt).toLocaleDateString("en-GB")}` : ""}{mk.source.uploadedBy ? ` by ${mk.source.uploadedBy}` : ""}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <QuestionCard question="Our share" hint={`${mk.ourBrand}, year to date`}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl")}>{fmtPct(mk.sharePct)}</div>
          <div className={cn("text-sm", tone(mk.sharePtsChange))}>{pts(mk.sharePtsChange)} vs last year ({fmtPct(mk.shareLyPct)})</div>
        </QuestionCard>
        <QuestionCard question="Our growth" hint="Year to date vs the same months last year">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", tone(mk.ourGrowthPct))}>{fmtPctSigned(mk.ourGrowthPct)}</div>
        </QuestionCard>
        <QuestionCard question="Market growth" hint="All brands in the sheet">
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", tone(mk.marketGrowthPct))}>{fmtPctSigned(mk.marketGrowthPct)}</div>
          <div className="text-sm text-muted-foreground">{mk.outgrowing === null ? "" : mk.outgrowing ? "We are outgrowing the market" : "The market is growing faster than us"}</div>
        </QuestionCard>
        <QuestionCard question="Main competitor" hint={mk.mainCompetitor ?? "Not identified"}>
          <div className={cn("font-bold", presentation ? "text-3xl" : "text-2xl", tone(mk.competitorGrowthPct))}>{fmtPctSigned(mk.competitorGrowthPct)}</div>
          <div className="text-sm text-muted-foreground">their growth, year to date</div>
        </QuestionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QuestionCard question="Is our share moving month by month?">
          {mk.trend.length === 0 ? <EmptyState message="No monthly data" /> : (
            <ResponsiveContainer width="100%" height={presentation ? 340 : 300}>
              <ComposedChart data={mk.trend}>
                <CartesianGrid stroke={PERF_COLORS.grid} vertical={false} /><XAxis dataKey="label" />
                <YAxis yAxisId="v" tickFormatter={(v: number) => v.toLocaleString("en-US")} label={{ value: mk.unit, angle: -90, position: "insideLeft", fontSize: 11 }} />
                <YAxis yAxisId="s" orientation="right" unit="%" />
                <Tooltip formatter={(v: number, name: string) => [name.includes("share") ? `${v.toFixed(1)}%` : v.toLocaleString("en-US"), name]} /><Legend />
                <Bar yAxisId="v" dataKey="ours" name={mk.ourBrand} fill={PERF_COLORS.accent} />
                <Bar yAxisId="v" dataKey="competitor" name={mk.mainCompetitor ?? "Main competitor"} fill={PERF_COLORS.plan} />
                <Line yAxisId="s" dataKey="sharePct" name="Our share %" stroke={PERF_COLORS.neutral} strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="s" dataKey="competitorSharePct" name="Competitor share %" stroke="#6b7280" strokeDasharray="4 4" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </QuestionCard>
        <QuestionCard question="How does every brand compare?" hint="Year to date, ranked by volume">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["Brand", `YTD (${mk.unit})`, "Last year", "Growth", "Share", "Share change"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{mk.brands.slice(0, presentation ? 10 : mk.brands.length).map((b) => (
                <tr className={cn("border-t", b.brand === mk.ourBrand && "bg-[#7f1d1d]/5 font-semibold")} key={b.brand}>
                  <td className={td}>{b.brand}</td><td className={td}>{num(b.ytd)}</td><td className={td}>{num(b.lastYear)}</td>
                  <td className={cn(td, tone(b.growthPct))}>{fmtPctSigned(b.growthPct)}</td><td className={td}>{fmtPct(b.sharePct)}</td><td className={cn(td, tone(b.sharePtsChange))}>{pts(b.sharePtsChange)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </QuestionCard>
      </div>

      <SectionNotes notes={mk.notes} />
    </div>
  );
}
