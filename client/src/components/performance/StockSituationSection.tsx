import { cn } from "@/lib/utils";
import type { SectionProps } from "./types";
import { EmptyState, QuestionCard } from "./shared";

const th = "px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const numericTh = "px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const td = "px-3 py-3 text-sm";
const numericTd = "px-3 py-3 text-right text-sm tabular-nums";

export default function StockSituationSection({ pack, presentation }: SectionProps) {
  const fmtMc = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const unitLabel = "MC";
  const situation = pack.stockSituation;

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <QuestionCard
        question="How much stock is available by SKU?"
        hint={`${pack.meta.country} · ${pack.meta.window.label}`}
      >
        <div className="mb-4 rounded-md border border-[#7f1d1d]/15 bg-[#7f1d1d]/[0.035] px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
          Production and arrival are actual totals for the selected window. International arrival means quantity cleared into the market. Remaining stock is the ending-month Planning FG closing stock; it is not calculated as production minus arrival.
        </div>

        {situation.rows.length === 0 ? (
          <EmptyState message="No stock situation data for the selected country and period." />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[700px] border-collapse" aria-label={`Stock situation by SKU for ${pack.meta.country}`}>
              <caption className="sr-only">
                Production, international arrivals cleared into market, and ending-month remaining stock by SKU in {unitLabel}.
              </caption>
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className={th}>SKU</th>
                  <th scope="col" className={numericTh}>Production <span className="normal-case font-normal">({unitLabel})</span></th>
                  <th scope="col" className={numericTh}>Arrival <span className="normal-case font-normal">({unitLabel})</span></th>
                  <th scope="col" className={numericTh}>Remaining stock <span className="normal-case font-normal">({unitLabel})</span></th>
                </tr>
              </thead>
              <tbody>
                {situation.rows.map((row) => {
                  const isNegative = row.remainingStock < 0;
                  return (
                    <tr
                      key={row.skuId}
                      className={cn(
                        "border-t",
                        isNegative ? "bg-red-50/80" : "odd:bg-background even:bg-muted/20",
                      )}
                    >
                      <th scope="row" className={cn(td, "text-left font-medium")}>
                        <span className="block text-foreground">{row.sku}</span>
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {row.weight} · {row.packaging}
                        </span>
                      </th>
                      <td className={cn(numericTd, "text-foreground")}>{fmtMc(row.production)}</td>
                      <td className={cn(numericTd, "text-foreground")}>{fmtMc(row.arrival)}</td>
                      <td className={cn(numericTd, "font-semibold", isNegative ? "text-red-800" : "text-foreground")}>
                        {isNegative && <span className="sr-only">Negative stock: </span>}
                        {fmtMc(row.remainingStock)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-foreground/15 bg-muted/60">
                <tr>
                  <th scope="row" className={cn(td, "text-left font-bold")}>Total</th>
                  <td className={cn(numericTd, "font-bold")}>{fmtMc(situation.totals.production)}</td>
                  <td className={cn(numericTd, "font-bold")}>{fmtMc(situation.totals.arrival)}</td>
                  <td className={cn(numericTd, "font-bold", situation.totals.remainingStock < 0 ? "text-red-800" : "")}>
                    {situation.totals.remainingStock < 0 && <span className="sr-only">Negative stock: </span>}
                    {fmtMc(situation.totals.remainingStock)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </QuestionCard>
    </div>
  );
}
