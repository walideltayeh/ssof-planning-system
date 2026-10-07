import { useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, FileCheck2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { trpc } from "@/lib/trpc";

export default function LibyaPoImport() {
  const { country } = useCountry();
  const { isAdminFor } = useAppAuth();
  const { formatVal, unitLabel } = useUnit();
  const isLibya = country === "Libya";
  const isAdmin = isLibya && isAdminFor("Libya");
  const utils = trpc.useUtils();
  const [actionError, setActionError] = useState("");
  const preview = trpc.focPlanning.poPreview.useQuery(
    { country: "Libya" },
    { enabled: isLibya, retry: false },
  );

  const importPo = trpc.focPlanning.poImport.useMutation({
    onSuccess: async (result) => {
      setActionError("");
      await Promise.all([
        utils.country.data.invalidate(),
        utils.focPlanning.list.invalidate({ country: "Libya" }),
        utils.country.performance.invalidate(),
      ]);
      if (result.alreadyApplied) {
        await preview.refetch();
        return;
      }
      if (result.success) await preview.refetch();
      else setActionError("Import was not applied. The current figures no longer match this reviewed preview; refresh and inspect them again.");
    },
    onError: (error) => {
      setActionError(error.data?.code === "FORBIDDEN"
        ? "Import denied: administrator access to Libya is required."
        : `Import failed and no changes were confirmed. ${error.message}`);
    },
  });

  if (!isLibya) return null;

  const data = preview.data;
  const denied = preview.error?.data?.code === "FORBIDDEN";
  const failed = !!preview.error && !denied;
  const qty = (mc: number) => formatVal(mc, 2);
  return (
    <Card className="overflow-hidden border-[#7f1d1d]/20">
      <CardHeader className="bg-[#f6eee8] pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7f1d1d]">Libya · reviewed source document</p>
            <CardTitle className="mt-1 text-lg">Purchase order FOC import</CardTitle>
          </div>
          <span className="rounded-md border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">{unitLabel} display · source in MC</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 md:p-5">
        {preview.isLoading && <div className="space-y-2" aria-label="Loading purchase order preview">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>}
        {denied && <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Libya country access denied. Check your access and retry.</div>}
        {failed && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm"><span>Purchase order preview could not be loaded.</span><Button variant="outline" size="sm" onClick={() => preview.refetch()}>Retry</Button></div>}
        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Source PO reference</span>
                <p className="mt-1 font-mono text-sm font-semibold">{data.reference}</p>
              </div>
              {data.applied && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />Already loaded</span>}
              {!isAdmin && !data.applied && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" />Viewer · preview only</span>}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[770px] text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left">SKU / month</th><th className="px-3 py-2 text-right">Ordered before</th><th className="px-3 py-2 text-right">Ordered after</th><th className="px-3 py-2 text-right">FOC before</th><th className="px-3 py-2 text-right">FOC after</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={`${row.skuId}:${row.periodId}:${index}`} className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium"><span className="block">{row.sku}</span><span className="text-xs font-normal text-muted-foreground">{row.month}</span></th>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{qty(Number(row.before))}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{qty(Number(row.ordered))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.beforeFoc === null ? "Not set" : qty(Number(row.beforeFoc))}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{qty(Number(row.foc))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:grid-cols-[.9fr_1.1fr]">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Domestic / export split</p>
                <div className="mt-2 divide-y">
                  {data.split.map((part) => <div key={part.month} className="flex justify-between gap-3 py-1.5 text-xs"><span>{part.month}</span><span className="text-right font-mono tabular-nums">Domestic {qty(Number(part.domestic))} · Export {qty(Number(part.export))}</span></div>)}
                </div>
              </div>
              <div className="rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-950">
                <p className="font-semibold">Approved rounding note</p>
                <p className="mt-1">{data.note}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-[#7f1d1d]/15 bg-[#7f1d1d]/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <Archive className="mt-0.5 h-4 w-4 shrink-0 text-[#7f1d1d]" />
                <span><strong className="text-foreground">Before writing:</strong> the import saves a complete rollback backup and an audit record, then writes ordered forecast and planned FOC separately. No SKU is created; unmatched rows stop the import.</span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => preview.refetch()} disabled={preview.isFetching}>Refresh preview</Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    className="gap-2 bg-[#7f1d1d] hover:bg-[#691717]"
                    disabled={data.applied || importPo.isPending || preview.isFetching}
                    onClick={() => { setActionError(""); importPo.mutate({ country: "Libya", token: data.token }); }}
                  >
                    <FileCheck2 className="h-4 w-4" />
                    {data.applied ? "Already loaded" : importPo.isPending ? "Saving backup and importing" : "Import reviewed PO"}
                  </Button>
                )}
              </div>
            </div>
            {actionError && <div role="alert" className="flex gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{actionError}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
