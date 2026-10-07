import type { FocSummary } from "@shared/performance/foc";
import type { FocReceiptSummary } from "@shared/performance/focReceipts";
import type { SectionProps } from "./types";
import { QuestionCard, Sparkline, usePerfFormat } from "./shared";

function known(value: number | null, format: (n: number) => string) {
  return value === null ? "Not set" : format(value);
}

type ReceiptFiguresWithMissing = FocReceiptSummary["total"] & { missing?: number };
type ReceiptSummaryWithMissing = Omit<FocReceiptSummary, "total" | "months" | "skus"> & {
  total: ReceiptFiguresWithMissing;
  months: (FocReceiptSummary["months"][number] & { missing?: number })[];
  skus: (FocReceiptSummary["skus"][number] & { missing?: number })[];
};

export default function FocSection({ pack }: SectionProps) {
  const summary: FocSummary | undefined = pack.foc;
  const { fmtMc } = usePerfFormat();
  const value = (n: number) => fmtMc(n, 2) ?? "Not set";
  if (!summary) {
    return (
      <QuestionCard question="Planned free product by month and SKU" hint={`${pack.meta.country} · planned FOC`}>
        <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">FOC data layer is not available in this analysis pack.</p>
          <p className="mt-1">No aggregate has been inferred. Planned free quantities are separate from warehouse receipts.</p>
        </div>
      </QuestionCard>
    );
  }

  const total = summary.total;
  const receipts: ReceiptSummaryWithMissing | undefined = summary.receipts as ReceiptSummaryWithMissing | undefined;
  const cohortProgress = (figure: { receivedForPlan: number; excluded: number; planned: number; missing?: number }) =>
    (figure.missing ?? 0) > 0 ? "Not set"
      : figure.planned > 0 ? `${Math.round((figure.receivedForPlan + figure.excluded) / figure.planned * 1000) / 10}%` : "Not set";
  const cohortQuantity = (figure: { receivedForPlan: number; excluded: number }) => value(figure.receivedForPlan + figure.excluded);
  const plannedReceiptFigure = (figure: { planned: number; missing?: number }) =>
    (figure.missing ?? 0) > 0 ? `Not set · ${value(figure.planned)} entered` : value(figure.planned);
  const awaitingReceiptFigure = (figure: { awaiting: number; missing?: number }) =>
    (figure.missing ?? 0) > 0 ? `Not set · ${value(figure.awaiting)} awaiting from entered cells` : value(figure.awaiting);
  const trendPoints = summary.months.map((month) => ({ label: month.label, value: month.foc }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1.15fr_.85fr]">
        <QuestionCard question="Planned free product, month by month" hint={`${summary.basisLabel} · ${summary.note}`}>
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border bg-muted/25 px-3 py-2">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">FOC trend</span>
              <span className="text-xs text-muted-foreground">Only complete months are plotted</span>
            </div>
            <Sparkline points={trendPoints} color="#7f1d1d" width={180} height={38} />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2 text-left">Month</th><th className="px-3 py-2 text-right">FOC</th><th className="px-3 py-2 text-right">% of ordered</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Missing cells</th></tr>
              </thead>
              <tbody>
                {summary.months.map((month) => (
                  <tr key={month.periodId} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{month.label}</th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{known(month.foc, value)}{month.missing > 0 && <span className="ml-1 text-xs text-muted-foreground">({value(month.enteredFoc)} entered)</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{month.percent === null ? "Not set" : `${month.percent}%`}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{value(month.ordered)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{month.missing}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-muted/40 font-semibold">
                <tr><th className="px-3 py-2 text-left">Total</th><td className="px-3 py-2 text-right font-mono tabular-nums">{known(total.foc, value)}{total.missing > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({value(total.enteredFoc)} entered)</span>}</td><td className="px-3 py-2 text-right tabular-nums">{total.percent === null ? "Not set" : `${total.percent}%`}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{value(total.ordered)}</td><td className="px-3 py-2 text-right tabular-nums">{total.missing}</td></tr>
              </tfoot>
            </table>
          </div>
        </QuestionCard>

        <QuestionCard question="FOC completeness and physical plan" hint="Totals use the supplied pack aggregates">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[#f5ece5] p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">FOC total</span>
              <strong className="mt-1 block font-mono text-xl tabular-nums">{known(total.foc, value)}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">{value(total.enteredFoc)} entered · {total.missing} missing</span>
            </div>
            <div className="rounded-lg border p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Physical plan</span>
              <strong className="mt-1 block font-mono text-xl tabular-nums">{known(total.physical, value)}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">{summary.basisLabel}</span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Physical totals reflect the main Include FOC selection: {summary.includeFoc ? "planned FOC is included" : "ordered volume only, FOC excluded"}. This FOC is planned free quantity, not warehouse receipts.
          </p>
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Percentage of ordered: {total.percent === null ? "Not set" : `${total.percent}%`}</p>
        </QuestionCard>
      </div>

      {receipts && (
        <QuestionCard question="FOC receipt reconciliation" hint="Calendar arrivals follow receipt date; progress remains attached to the original plan cohort">
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-950">
            A receipt dated in a later month shifts stock into that landing month, while its received percentage remains credited to the month it was planned. Unset FOC cells are missing, not zero; figures below reflect configured plan cells only. Awaiting, excluded-by-switch, and pending-review quantities are not stock.
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2 text-left">Month</th><th className="px-3 py-2 text-right">Planned</th><th className="px-3 py-2 text-right">Received in stock</th><th className="px-3 py-2 text-right">Received for plan cohort</th><th className="px-3 py-2 text-right">Awaiting</th><th className="px-3 py-2 text-right">Excluded by switch</th><th className="px-3 py-2 text-right">Pending review</th><th className="px-3 py-2 text-right">Received %</th></tr>
              </thead>
              <tbody>{receipts.months.map((month) => (
                <tr key={month.periodId} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{month.label}</th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{plannedReceiptFigure(month)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{value(month.received)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{cohortQuantity(month)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{awaitingReceiptFigure(month)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{value(month.excluded)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{value(month.reviewPending)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cohortProgress(month)}</td>
                </tr>
              ))}</tbody>
              <tfoot className="border-t-2 bg-muted/40 font-semibold">
                <tr><th className="px-3 py-2 text-left">Total</th><td className="px-3 py-2 text-right font-mono tabular-nums">{plannedReceiptFigure(receipts.total)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{value(receipts.total.received)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{cohortQuantity(receipts.total)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{awaitingReceiptFigure(receipts.total)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{value(receipts.total.excluded)}</td><td className="px-3 py-2 text-right font-mono tabular-nums">{value(receipts.total.reviewPending)}</td><td className="px-3 py-2 text-right">{cohortProgress(receipts.total)}</td></tr>
              </tfoot>
            </table>
          </div>
          {receipts.warnings.length > 0 && <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-950">Possible duplicate receipts · held for explicit review</p>
            <div className="mt-2 divide-y divide-amber-200">
              {receipts.warnings.map((entry) => <div key={`${entry.skuId}:${entry.periodId}`} className="py-2 text-xs">
                <p className="font-medium">{entry.sku} · plan {entry.planMonth} → landing {entry.receiptMonth} · {value(entry.quantity)} · {entry.decision === "included" ? "Already counted" : entry.decision === "separate" ? "Separate shipment" : "Decision required"}</p>
                {entry.matches.length > 0 && <p className="mt-1 text-amber-900">{entry.matches.map((match) => `${match.source} · ${match.date} · ${value(match.quantity)}`).join(" / ")}</p>}
                <p className="mt-1 text-muted-foreground">This quantity is withheld from additions until a current evidence-matched decision is recorded.</p>
              </div>)}
            </div>
          </div>}
        </QuestionCard>
      )}

      <QuestionCard question="Largest FOC SKUs" hint="Ranked by entered planned FOC; missing cells remain visible">
        {summary.skus.length === 0 ? <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No SKU FOC rows in this period.</p> : (
          <div className="divide-y">
            {summary.skus.slice(0, 8).map((sku, index) => (
              <div key={sku.skuId} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{sku.label}</p>
                  <p className="text-xs text-muted-foreground">{sku.weight} · {sku.packaging} · {sku.missing} missing</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold tabular-nums">{known(sku.foc, value)}</p>
                  <p className="text-xs text-muted-foreground">{value(sku.enteredFoc)} entered · {sku.percent === null ? "Not set" : `${sku.percent}%`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </QuestionCard>
    </div>
  );
}
