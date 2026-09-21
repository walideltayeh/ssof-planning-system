import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Snowflake, Trash2 } from "lucide-react";
import { compareHeadlines } from "../../../../shared/performance/boardCompare";
import { usePerformanceContext } from "./PerformanceContext";
import type { PerformanceRequest, SectionProps } from "./types";
import { EmptyState, QuestionCard, RagDot, usePerfFormat } from "./shared";

const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-2 text-sm";

export interface BoardChangesProps extends SectionProps {
  /** The header's current request, used when freezing a new board pack. */
  request?: PerformanceRequest;
}

export default function BoardChangesSection({ pack, presentation, request }: BoardChangesProps) {
  const ctx = usePerformanceContext();
  const { fmtMc, fmtMcSigned, fmtPctSigned, unitLabel } = usePerfFormat();
  const utils = trpc.useUtils();
  const country = pack.meta.country;
  const snapshots = trpc.country.boardSnapshots.useQuery({ country });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [showFreeze, setShowFreeze] = useState(false);
  // Only honour a selection that belongs to the current country's list, so a
  // country switch can never compare against another country's frozen pack.
  const chosenId = (selectedId !== null && snapshots.data?.some((s) => s.id === selectedId) ? selectedId : snapshots.data?.[0]?.id) ?? null;
  const snapshot = trpc.country.boardSnapshot.useQuery({ id: chosenId ?? 0 }, { enabled: chosenId !== null });
  const freeze = trpc.country.freezeBoardPack.useMutation({
    onSuccess: (row) => {
      void utils.country.boardSnapshots.invalidate({ country });
      setSelectedId(row.id);
      setName("");
      setShowFreeze(false);
    },
  });
  const remove = trpc.country.deleteBoardSnapshot.useMutation({
    onSuccess: () => {
      void utils.country.boardSnapshots.invalidate({ country });
      setSelectedId(null);
    },
  });
  const comparison = useMemo(() => (snapshot.data ? compareHeadlines(pack.headline, snapshot.data.headline) : null), [pack.headline, snapshot.data]);
  const unitText = (unit: string, v: number | null) => (v === null ? "–" : unit === "MC" ? fmtMc(v) : unit === "weeks" ? `${v.toFixed(1)} wks` : unit === "pct" ? `${v.toFixed(1)}%` : String(v));
  const deltaText = (unit: string, v: number | null) => (v === null ? "–" : unit === "MC" ? fmtMcSigned(v) : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(unit === "count" ? 0 : 1)}${unit === "weeks" ? " wks" : unit === "pct" ? " pts" : ""}`);

  const freezeControls = ctx?.canEdit && !presentation && (
    <div className="perf-no-print flex flex-wrap items-center gap-2">
      {showFreeze ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Board ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`} className="h-8 w-56" maxLength={255} />
          <Button size="sm" disabled={!name.trim() || freeze.isPending || !request} onClick={() => request && freeze.mutate({ ...request, name: name.trim() })}>{freeze.isPending ? "Freezing…" : "Freeze now"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowFreeze(false)}>Cancel</Button>
          {freeze.error && <span className="text-xs text-red-700">{freeze.error.message}</span>}
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setShowFreeze(true)}><Snowflake />Freeze Board Pack</Button>
      )}
    </div>
  );

  return (
    <div className={presentation ? "space-y-5 text-base" : "space-y-4"}>
      <QuestionCard
        question="What changed since the last board?"
        hint="Today's headline numbers against the board pack that was frozen last time"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(snapshots.data?.length ?? 0) > 1 && !presentation && (
              <Select value={chosenId === null ? "" : String(chosenId)} onValueChange={(v) => setSelectedId(Number(v))}>
                <SelectTrigger size="sm" className="perf-no-print min-w-56"><SelectValue placeholder="Compare with…" /></SelectTrigger>
                <SelectContent>{snapshots.data!.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} — {new Date(s.createdAt).toLocaleDateString()}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {freezeControls}
          </div>
        }
      >
        {snapshots.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading previous board packs…</p>
        ) : !snapshot.data || !comparison ? (
          <EmptyState message={ctx?.canEdit ? "No board pack has been frozen for this country yet. Freeze one after this meeting so the next pack can show what moved." : "No board pack has been frozen for this country yet."} />
        ) : (
          <>
            <div className={cn("rounded-lg border-l-4 border-[#7f1d1d] bg-[#7f1d1d]/5 p-3", presentation && "text-xl")}>
              <p className="font-medium">{comparison.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Compared with “{snapshot.data.name}” ({snapshot.data.windowLabel}), frozen {new Date(snapshot.data.createdAt).toLocaleString()} by {snapshot.data.frozenBy}
                {!comparison.sameYear && " · different planning year — forecast revisions not compared"}
              </p>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <table className="w-full">
                <thead><tr>{["Measure", "Then", "Now", "Change"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                <tbody>
                  {comparison.changes.map((c) => {
                    const good = c.delta === null || c.delta === 0 || c.higherIsBetter === null ? null : c.higherIsBetter ? c.delta > 0 : c.delta < 0;
                    return (
                      <tr className="border-t" key={c.key}>
                        <td className={td}>{c.label}</td><td className={td}>{unitText(c.unit, c.before)}</td><td className={cn(td, "font-medium")}>{unitText(c.unit, c.after)}</td>
                        <td className={cn(td, good === null ? "" : good ? "text-green-700" : "text-red-700")}>{deltaText(c.unit, c.delta)}{c.pct !== null ? ` (${fmtPctSigned(c.pct)})` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-sm font-semibold">New risks ({comparison.risksAdded.length})</div>
                  {comparison.risksAdded.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
                    <ul className="space-y-1 text-sm">{comparison.risksAdded.slice(0, 8).map((r) => <li key={`${r.sku}-${r.issue}`} className="flex items-center gap-2"><RagDot status={r.severity} />{r.sku} — {r.issue}</li>)}</ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-sm font-semibold">Risks resolved ({comparison.risksResolved.length})</div>
                  {comparison.risksResolved.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
                    <ul className="space-y-1 text-sm text-muted-foreground">{comparison.risksResolved.slice(0, 8).map((r) => <li key={`${r.sku}-${r.issue}`}>{r.sku} — {r.issue}</li>)}</ul>
                  )}
                </div>
                {comparison.forecastRevisions.length > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-semibold">Forecast revised since then — net {fmtMcSigned(comparison.totalForecastRevisionMc)} {unitLabel}</div>
                    <table className="w-full">
                      <thead><tr>{["SKU", "Remaining forecast then", "Now", "Change"].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead>
                      <tbody>{comparison.forecastRevisions.slice(0, presentation ? 6 : 12).map((r) => (
                        <tr className="border-t" key={`${r.sku}-${r.weight}`}><td className={td}>{r.sku} <span className="text-xs text-muted-foreground">{r.weight}</span></td><td className={td}>{fmtMc(r.before)}</td><td className={td}>{fmtMc(r.after)}</td><td className={cn(td, r.delta >= 0 ? "text-green-700" : "text-red-700")}>{fmtMcSigned(r.delta)}{r.pct !== null ? ` (${fmtPctSigned(r.pct)})` : ""}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            {ctx?.canEdit && !presentation && (
              <div className="perf-no-print mt-3 text-right">
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete the frozen pack “${snapshot.data?.name}”? This cannot be undone.`)) remove.mutate({ country, id: snapshot.data!.id }); }}><Trash2 />Delete this frozen pack</Button>
              </div>
            )}
          </>
        )}
      </QuestionCard>
    </div>
  );
}
