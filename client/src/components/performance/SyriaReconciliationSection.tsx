import { AlertTriangle, Check, CircleHelp, ExternalLink } from "lucide-react";
import { useUnit } from "@/contexts/UnitContext";
import { stockTextInUnit } from "@shared/performance/units";
import type { ReconciliationBreakdown, ReconciliationDetail, SyriaReconciliationLine } from "@shared/performance/syriaReconciliation";
import type { SectionProps } from "./types";
import { QuestionCard, usePerfFormat } from "./shared";

const cell = "px-3 py-3 text-sm";
const numberCell = `${cell} text-right tabular-nums`;

// Keep the accounting identity visible, even for fractional MC or tiny tons.
// Other countries retain their existing formatting.
function useReconciliationFormat() {
  const { convertVal } = usePerfFormat();
  const { unit } = useUnit();
  const fmtMc = (v: number | null) => v === null ? "–" : convertVal(v).toLocaleString("en-US", {
    minimumFractionDigits: unit === "Tons" ? 2 : 0,
    maximumFractionDigits: unit === "Tons" ? 6 : 2,
  });
  const fmtMcSigned = (v: number | null) => v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMc(Math.abs(v))}`;
  return { fmtMc, fmtMcSigned };
}

function signedText(value: number | null, format: (v: number | null) => string) {
  return value === null ? "Not supplied" : format(value);
}

function planningRouteForSku(sku: string) {
  const weight = sku.match(/\b(\d+(?:\.\d+)?\s*(?:g|kg))\b/i)?.[1]?.replace(/\s+/g, "").toLowerCase();
  return weight ? `/planning-fg/${encodeURIComponent(weight)}` : null;
}

function DetailRows({ details }: { details: ReconciliationDetail[] }) {
  const { fmtMcSigned } = useReconciliationFormat();
  const { unit } = useUnit();
  if (!details.length) return <span className="text-muted-foreground">No SKU/month details supplied.</span>;
  return (
    <ul className="mt-2 space-y-2">
      {details.map((detail, index) => {
        const planningRoute = planningRouteForSku(detail.sku);
        return <li key={`${detail.sku}-${detail.month}-${index}`} className="rounded-md border border-border/70 bg-background px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <span className="font-medium">{detail.sku}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{fmtMcSigned(detail.mc)} <span className="font-sans font-normal text-muted-foreground">{unit}</span></span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Month: <span className="text-foreground">{detail.month}</span>
            {detail.trackerMonth && <> · WS Tracker month: <span className="text-foreground">{detail.trackerMonth}</span></>}
            {detail.ssofMonth && <> · SSOF month: <span className="text-foreground">{detail.ssofMonth}</span></>}
          </p>
          {detail.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stockTextInUnit(detail.note, unit)}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <a href="/arrival" className="inline-flex items-center gap-1 rounded text-xs font-medium text-[#7f1d1d] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Arrival <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            {planningRoute && (
              <a href={planningRoute} className="inline-flex items-center gap-1 rounded text-xs font-medium text-[#7f1d1d] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Planning FG <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </li>;
      })}
    </ul>
  );
}

function Breakdown({ breakdown }: { breakdown: ReconciliationBreakdown[] }) {
  const { fmtMcSigned } = useReconciliationFormat();
  const { unit } = useUnit();
  if (!breakdown.length) {
    return <p className="mt-2 text-xs text-muted-foreground">No explanation breakdown supplied; the difference remains unclassified.</p>;
  }
  const residualKnown = typeof breakdown.find(part => part.cause === "unexplained")?.mc === "number";
  const knownTotal = residualKnown ? breakdown.reduce((sum, part) => sum + (part.mc ?? 0), 0) : null;
  return (
    <div className="mt-3 space-y-2">
      {breakdown.map((part, index) => (
        <article key={`${part.cause}-${index}`} className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold">{part.label}</h4>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {signedText(part.mc, fmtMcSigned)} <span className="font-sans font-normal text-muted-foreground">{part.mc === null ? "" : unit}</span>
            </span>
          </div>
          {part.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stockTextInUnit(part.note, unit)}</p>}
          <div className="mt-2 text-xs">
            <DetailRows details={part.details} />
          </div>
        </article>
      ))}
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Accounted contributions + unexplained: <strong className="font-mono text-foreground">{knownTotal === null ? "Not fully known" : `${fmtMcSigned(knownTotal)} ${unit}`}</strong>
        {breakdown.some(part => part.mc === null) && <span> · Missing inputs are not assumed to be zero; any remaining measured gap is included in unexplained.</span>}
      </p>
    </div>
  );
}

function ReconciliationRow({ line }: { line: SyriaReconciliationLine }) {
  const { fmtMc, fmtMcSigned } = useReconciliationFormat();
  const { unit } = useUnit();
  const isKnownTie = line.ties === true && line.tracker !== null && line.ssof !== null && line.difference !== null;
  const unavailable = line.tracker === null || line.ssof === null || line.difference === null;
  return (
    <>
      <tr className="border-t align-top odd:bg-background even:bg-muted/20">
        <th scope="row" className={`${cell} text-left font-semibold`}>
          {line.label}
          {line.id === "ims" && <span className="mt-1 block text-xs font-normal text-muted-foreground">Total IMS</span>}
        </th>
        <td className={numberCell}>{signedText(line.tracker, fmtMc)}{line.tracker !== null && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}</td>
        <td className={numberCell}>{signedText(line.ssof, fmtMc)}{line.ssof !== null && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}</td>
        <td className={`${numberCell} font-semibold ${line.difference !== null && line.difference !== 0 ? "text-[#7f1d1d]" : ""}`}>
          {signedText(line.difference, fmtMcSigned)}{line.difference !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
        </td>
        <td className={`${cell} text-right`}>
          {isKnownTie ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-700/[0.07] px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <Check className="size-3.5" aria-hidden="true" /> Ties
            </span>
          ) : unavailable ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800"><CircleHelp className="size-3.5" aria-hidden="true" /> Unknown</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7f1d1d]"><AlertTriangle className="size-3.5" aria-hidden="true" /> Does not tie</span>
          )}
        </td>
      </tr>
      {(!isKnownTie || line.breakdown.some(part => part.cause === "dated" ? part.details.length > 0 : part.details.some(d => d.mc !== 0))) && (
        <tr className="border-t bg-muted/10">
          <td colSpan={5} className="px-3 py-3">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Difference explanation</h3>
                <Breakdown breakdown={line.breakdown} />
              </div>
              {line.missing.length > 0 && (
                <aside className="rounded-md border border-amber-700/20 bg-amber-700/[0.045] p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">Warehouse data missing</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-950">
                    {line.missing.map((item, i) => <li key={`${item}-${i}`}>{stockTextInUnit(item, unit)}</li>)}
                  </ul>
                </aside>
              )}
              {line.id === "warehouse" && line.missing.length === 0 && (
                <p className="self-start rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">No missing warehouse fields reported by the comparison.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ title, description, details }: { title: string; description: string; details: ReconciliationDetail[] }) {
  const { unit } = useUnit();
  return (
    <section className="rounded-lg border border-border/80 bg-background p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{stockTextInUnit(description, unit)}</p>
      {details.length > 0 && (
        <div className="mt-3"><DetailRows details={details} /></div>
      )}
    </section>
  );
}

export default function SyriaReconciliationSection({ pack }: SectionProps) {
  const { unit } = useUnit();
  const { fmtMc, fmtMcSigned } = useReconciliationFormat();
  const reconciliation = pack.syriaReconciliation;
  const unavailable = !reconciliation || reconciliation.status !== "available" || Boolean(reconciliation.error);
  const mapped = reconciliation?.mappedIms;
  return (
    <div className="space-y-4">
      <QuestionCard question="Can every Syria stock and sales difference be traced?" hint="Live reconciliation · WS Tracker minus SSOF">
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-[#7f1d1d]/15 bg-[#7f1d1d]/[0.035] px-3 py-3 text-sm md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-semibold text-foreground">Syria-wide comparison</p>
            <p className="mt-1 text-muted-foreground">Whole Syria; this check ignores the Analysis page SKU filters. All backend quantities are mastercases and are displayed in {unit}.</p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-xs md:text-right">
            <dt className="text-muted-foreground">Compared period</dt><dd className="font-medium text-foreground">{reconciliation ? `${reconciliation.from} – ${reconciliation.to}` : "Not supplied"}</dd>
            <dt className="text-muted-foreground">Sources generated</dt><dd className="font-medium text-foreground">{reconciliation?.generatedAt ?? "Not supplied"}</dd>
            <dt className="text-muted-foreground">Comparison checked</dt><dd className="font-medium text-foreground">{reconciliation?.checkedAt ?? "Not supplied"}</dd>
          </dl>
        </div>
        {unavailable ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-700/25 bg-amber-700/[0.06] p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
            <div><p className="font-semibold text-amber-950">Comparison unavailable</p><p className="mt-1 text-amber-950/80">{reconciliation?.error ? stockTextInUnit(reconciliation.error, unit) : "The live Syria reconciliation was not supplied or could not be completed. No balances are inferred."}</p></div>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{stockTextInUnit(reconciliation.conclusion, unit)}</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] border-collapse" aria-label="Syria WS Tracker and SSOF reconciliation">
                <caption className="sr-only">Source balances and signed differences in {unit}; a tie is shown only when both source balances and the difference are known.</caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Measure</th>
                    <th scope="col" className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">WS Tracker <span className="normal-case font-normal">({unit})</span></th>
                    <th scope="col" className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">SSOF <span className="normal-case font-normal">({unit})</span></th>
                    <th scope="col" className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Difference <span className="normal-case font-normal">(WS − SSOF, {unit})</span></th>
                    <th scope="col" className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result</th>
                  </tr>
                </thead>
                <tbody>{reconciliation.lines.map((line) => <ReconciliationRow key={line.id} line={line} />)}</tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <section className="rounded-lg border border-border/80 bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">Mapped IMS subset</h3>
                {mapped ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>Tracker {fmtMc(mapped.tracker)} {unit} · SSOF {fmtMc(mapped.ssof)} {unit}</span>
                    <span className={mapped.ties ? "inline-flex items-center gap-1 font-semibold text-emerald-800" : "font-semibold text-[#7f1d1d]"}>
                      {mapped.ties && <Check className="size-4" aria-hidden="true" />}{mapped.ties ? "Mapped IMS ties" : `Difference ${fmtMcSigned(mapped.tracker - mapped.ssof)} ${unit}`}
                    </span>
                  </div>
                ) : <p className="mt-2 text-sm text-muted-foreground">Not supplied</p>}
                <p className="mt-2 text-xs text-muted-foreground">This mapped-SKU equality is separate from the total IMS row above.</p>
              </section>
              <section className="rounded-lg border border-border/80 bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">Reconciliation chain start</h3>
                <p className="mt-2 text-sm text-muted-foreground">{reconciliation.chainStart ?? "Not supplied"}</p>
              </section>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <DetailPanel
                title="Pending production"
                description="Diagnostic only: pending production is not proof of warehouse receipt and is not added to the reconciliation gap."
                details={reconciliation.pendingProduction}
              />
              <DetailPanel
                title="Ignored opening entries"
                description="Diagnostic only: the current carry-forward rule does not apply these later opening entries, so they contribute nothing to the reconciliation gap."
                details={reconciliation.ignoredOpeningEntries}
              />
            </div>
            <p className="mt-3 border-l-2 border-amber-700/50 pl-3 text-xs leading-relaxed text-muted-foreground">
              {reconciliation.warning ? "The comparison includes a data warning. " : ""}
              Scope: {stockTextInUnit(reconciliation.scope, unit)}
            </p>
          </>
        )}
      </QuestionCard>
    </div>
  );
}
