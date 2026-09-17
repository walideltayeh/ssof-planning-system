import type { SectionProps } from "./types";
import { EmptyState, QuestionCard, SectionNotes, usePerfFormat } from "./shared";

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";

export default function CommercialSection({ pack, presentation }: SectionProps) {
  const c = pack.commercial;
  const { fmtUsd, fmtPct, fmtPctSigned } = usePerfFormat();
  const selloutGrowthPct = c.selloutUsd !== null && c.selloutLyUsd !== null && c.selloutLyUsd !== 0
    ? ((c.selloutUsd - c.selloutLyUsd) / Math.abs(c.selloutLyUsd)) * 100
    : null;
  if (!c.hasPrices) return <div className="space-y-3"><QuestionCard question="What is the value of our sell-out and stock?"><EmptyState message="No wholesale prices are set for this country yet. Add priceToWs in SKU Management to see values." /></QuestionCard><SectionNotes notes={c.notes} /></div>;

  const table = (rows: typeof c.byWeight) => <div className="overflow-x-auto"><table className="w-full"><thead><tr>
    {["Group", "Sell-out value", "Last year", "Growth", "Stock value", "Volume priced"].map((x) => <th className={th} key={x}>{x}</th>)}
  </tr></thead><tbody>{rows.slice(0, presentation ? 8 : undefined).map((r) => <tr className="border-t" key={r.group}><td className={td}>{r.group}</td><td className={td}>{fmtUsd(r.selloutUsd)}</td><td className={td}>{fmtUsd(r.selloutLyUsd)}</td><td className={`${td} ${(r.selloutGrowthPct ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtPctSigned(r.selloutGrowthPct)}</td><td className={td}>{fmtUsd(r.stockUsd)}</td><td className={td}>{fmtPct(r.pricedSharePct)}</td></tr>)}</tbody></table>
    {presentation && rows.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{rows.length - 8} more in the full pack</p>}</div>;

  return <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
    <div className="grid gap-4 md:grid-cols-3">
      <QuestionCard question="What is our sell-out worth?"><div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{fmtUsd(c.selloutUsd)}</div>{selloutGrowthPct === null ? <p className="text-xs text-muted-foreground">No prior year data</p> : <p className={`text-sm ${selloutGrowthPct >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtPctSigned(selloutGrowthPct)} vs last year ({fmtUsd(c.selloutLyUsd)})</p>}</QuestionCard>
      <QuestionCard question="What is our stock worth?"><div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{fmtUsd(c.stockUsd)}</div></QuestionCard>
      <QuestionCard question="How much volume has a price?"><div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{fmtPct(c.pricedVolumeSharePct)}</div><p className="text-sm text-muted-foreground">of volume has a price</p></QuestionCard>
    </div>
    <div className="grid gap-4 md:grid-cols-2"><QuestionCard question="How does value split by weight?">{table(c.byWeight)}</QuestionCard><QuestionCard question="How does value split by category?">{table(c.byCategory)}</QuestionCard></div>
    <QuestionCard question="Which SKUs are not valued?">
      {!c.skusMissingPrice.length ? <p className="text-sm text-muted-foreground">Every SKU in this view has a wholesale price.</p> : <div className="flex flex-wrap gap-2">{c.skusMissingPrice.map((sku) => <span className="rounded-full border bg-muted px-3 py-1 text-sm" key={sku}>{sku}</span>)}</div>}
      <p className="mt-2 text-xs text-muted-foreground">Missing prices are never estimated.</p>
    </QuestionCard>
    <SectionNotes notes={c.notes} />
  </div>;
}