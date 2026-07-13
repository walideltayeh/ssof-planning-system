import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";
import { weightGrams, packsPerMc, tierPricesOf } from "@/lib/packUnits";

type Country = "Lebanon" | "Syria" | "Libya" | "KSA";

// The four editable price fields, in supply-chain order.
const PRICE_FIELDS = [
  { key: "priceToWs" as const,           label: "Selling price to WS",        unit: "$/MC",   perPack: true },
  { key: "priceWsToSemiWs" as const,     label: "WS → Semi-WS / Tobacconist", unit: "$/MC",   perPack: true },
  { key: "priceSemiWsToRetail" as const, label: "Semi-WS → Retail",           unit: "$/MC",   perPack: true },
  { key: "finalRspPerPack" as const,     label: "Final RSP",                  unit: "$/pack", perPack: false },
];
type PriceField = (typeof PRICE_FIELDS)[number]["key"];

type PriceRow = {
  id: number;
  name: string;
  weight: string;
  isActive: boolean;
  priceToWs: string | null;
  priceWsToSemiWs: string | null;
  priceSemiWsToRetail: string | null;
  finalRspPerPack: string | null;
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

// Editable price cell — commits on blur / Enter when the value changed.
function PriceCell({
  row, field, isAdmin, onSave, saving,
}: {
  row: PriceRow;
  field: (typeof PRICE_FIELDS)[number];
  isAdmin: boolean;
  onSave: (skuId: number, skuName: string, key: PriceField, value: number | null) => void;
  saving: boolean;
}) {
  const stored = row[field.key];
  const storedNum = stored === null || stored === "" ? null : parseFloat(stored);
  const [draft, setDraft] = useState<string | null>(null); // null = not editing

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === "") {
      if (storedNum !== null) onSave(row.id, row.name, field.key, null);
      return;
    }
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a price of 0 or more."); return; }
    const rounded = Math.round(n * 100) / 100;
    if (storedNum !== null && Math.abs(rounded - storedNum) < 0.005) return;
    onSave(row.id, row.name, field.key, rounded);
  };

  // Derived equivalent shown under the value: per-pack for $/MC tiers,
  // per-MC for the RSP (entered per pack).
  const p = packsPerMc(row.weight);
  const shown = draft !== null ? parseFloat(draft) : storedNum;
  let equiv = "";
  if (p && shown !== null && Number.isFinite(shown)) {
    equiv = field.perPack
      ? `$${fmtMoney(shown / p.count)} / ${p.unit === "packs" ? "pack" : "piece"}`
      : `$${fmtMoney(shown * p.count)} / MC`;
  }

  if (!isAdmin) {
    return (
      <div className="text-right">
        <span className="tabular-nums">{storedNum === null ? "—" : `$${fmtMoney(storedNum)}`}</span>
        {equiv && <div className="text-[10px] text-muted-foreground">{equiv}</div>}
      </div>
    );
  }

  return (
    <div>
      <Input
        inputMode="decimal"
        placeholder="—"
        disabled={saving}
        value={draft !== null ? draft : storedNum === null ? "" : String(storedNum)}
        onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
        onFocus={e => { setDraft(storedNum === null ? "" : String(storedNum)); e.target.select(); }}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
        className="h-8 w-24 text-right tabular-nums ml-auto"
      />
      <div className="text-[10px] text-muted-foreground text-right mt-0.5 min-h-[14px]">{equiv}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Supply-chain price list — one row per active SKU, four price tiers.
// Trade-tier prices are entered per MC; the Final RSP is entered per pack.
// These prices feed the Trade Offers page (each channel is invoiced at its
// own tier price instead of the single WS list price).
// ────────────────────────────────────────────────────────────────────────────
export default function SkuPriceListCard({ country, isAdmin }: { country: Country; isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const { data: skusData, isLoading } = trpc.country.skus.useQuery(
    { country, includeInactive: true },
    { enabled: !!country }
  );
  const [savingSkuId, setSavingSkuId] = useState<number | null>(null);

  const updateMutation = trpc.country.updateSku.useMutation({
    onSuccess: () => { utils.country.skus.invalidate(); toast.success("Price saved."); },
    onError: (err) => { utils.country.skus.invalidate(); toast.error(`Price not saved: ${err.message}`); },
    onSettled: () => setSavingSkuId(null),
  });

  const rows = useMemo(() => {
    const list = ((skusData as PriceRow[] | undefined) ?? []).filter(s => s.isActive);
    return [...list].sort((a, b) => {
      const ga = weightGrams(a.weight) ?? 0;
      const gb = weightGrams(b.weight) ?? 0;
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name);
    });
  }, [skusData]);

  const byWeight = useMemo(() => {
    const groups = new Map<string, PriceRow[]>();
    for (const r of rows) {
      const g = groups.get(r.weight) ?? [];
      g.push(r);
      groups.set(r.weight, g);
    }
    return groups;
  }, [rows]);

  const pricedCount = rows.filter(r => tierPricesOf(r).toWs !== null || tierPricesOf(r).wsToSemiWs !== null || tierPricesOf(r).semiWsToRetail !== null || tierPricesOf(r).rspPerPack !== null).length;

  const save = (skuId: number, skuName: string, key: PriceField, value: number | null) => {
    setSavingSkuId(skuId);
    updateMutation.mutate({ skuId, country, skuName, [key]: value });
  };

  if (!isLoading && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-600" />
          <CardTitle className="text-base">Supply-chain price list</CardTitle>
          <span className="text-xs text-muted-foreground ml-auto">
            {pricedCount} of {rows.length} SKUs priced
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The three trade prices are per <strong>mastercase (MC)</strong>; the Final RSP is per <strong>pack</strong> — the
          per-pack / per-MC equivalent shows under each value. These prices flow straight into the Trade Offers page, where
          each channel is invoiced at its own tier.{isAdmin ? " Click a cell to edit; leave it empty to clear." : ""}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            {[...byWeight.entries()].map(([weight, group]) => (
              <div key={weight}>
                <div className="px-4 py-2 bg-muted/40 border-y border-border/50">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{weight}</span>
                  <span className="text-xs text-muted-foreground ml-2">({group.length} SKUs)</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground">
                      <th className="text-left font-medium px-4 py-2">SKU</th>
                      {PRICE_FIELDS.map(f => (
                        <th key={f.key} className="text-right font-medium px-4 py-2 whitespace-nowrap">
                          {f.label}
                          <span className="block font-normal">{f.unit}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(row => (
                      <tr key={row.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{row.name}</td>
                        {PRICE_FIELDS.map(f => (
                          <td key={f.key} className="px-4 py-2 text-right align-top">
                            <PriceCell
                              row={row}
                              field={f}
                              isAdmin={isAdmin}
                              onSave={save}
                              saving={savingSkuId === row.id && updateMutation.isPending}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
