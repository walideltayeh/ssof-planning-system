import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, QuestionCard, RagBadge, SectionNotes, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

export default function AnomaliesSection({ pack, presentation }: SectionProps) {
  const an = pack.anomalies;
  const { fmtMc, fmtMcSigned, fmtPctSigned, unitLabel } = usePerfFormat();
  const rows = presentation ? an.rows.slice(0, 10) : an.rows;
  const reds = an.rows.filter((r) => r.severity === "red").length;

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <QuestionCard
        question="Which months look unusual and need an explanation?"
        hint={`${an.rows.length} unusual month${an.rows.length === 1 ? "" : "s"} (${reds} severe) across ${an.monthsScanned} months scanned · ${an.method}`}
      >
        {rows.length === 0 ? <EmptyState message="Nothing unusual in the recent history" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["What", "Measure", "Month", `Value (${unitLabel})`, "Expected", "Deviation", "Severity", "Likely explanation"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr className="border-t" key={`${r.scope}-${r.name}-${r.measure}-${r.month}-${i}`}>
                  <td className={cn(td, "font-medium")}>{r.name}<span className="block text-xs font-normal text-muted-foreground">{r.scope === "sku" ? r.weight : "weight group"}</span></td>
                  <td className={td}>{r.measure}</td><td className={td}>{r.month}</td><td className={td}>{fmtMc(r.value)}</td><td className={td}>{fmtMc(r.expected)}</td>
                  <td className={cn(td, r.direction === "above" ? "text-green-700" : "text-red-700")}>{fmtMcSigned(r.deviationMc)}{r.deviationPct !== null ? ` (${fmtPctSigned(r.deviationPct)})` : ""}<span className="block text-xs text-muted-foreground">z = {r.zScore.toFixed(1)}</span></td>
                  <td className={td}><RagBadge status={r.severity} text={r.severity === "red" ? "Severe" : r.severity === "amber" ? "Notable" : "Minor"} /></td>
                  <td className={cn(td, "max-w-72 whitespace-normal text-xs text-muted-foreground")}>{r.explanation}</td>
                </tr>
              ))}</tbody>
            </table>
            {presentation && an.rows.length > 10 && <p className="mt-2 text-xs text-muted-foreground">+{an.rows.length - 10} more on the page</p>}
          </div>
        )}
      </QuestionCard>
      <SectionNotes notes={an.notes} />
    </div>
  );
}
