/**
 * Shared building blocks for the Country Performance pack.
 * Every section component imports from here so the pack looks and reads consistently.
 */
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnit } from "@/contexts/UnitContext";
import { cn } from "@/lib/utils";
import type { Delta, KpiUnit, Rag, SparkPoint } from "./types";

/** The pack's palette: the app's dark-red accent plus neutral supporting tones. */
export const PERF_COLORS = {
  accent: "#7f1d1d",
  accentSoft: "#b91c1c",
  plan: "#9ca3af",
  lastYear: "#d1d5db",
  positive: "#15803d",
  warning: "#b45309",
  negative: "#b91c1c",
  neutral: "#374151",
  grid: "#e5e7eb",
  band: "rgba(21, 128, 61, 0.10)",
  series: ["#7f1d1d", "#374151", "#9ca3af", "#b45309", "#15803d", "#1d4ed8", "#6b7280", "#a16207"],
} as const;

export const RAG_STYLES: Record<Rag, { dot: string; text: string; bg: string; label: string }> = {
  green: { dot: "bg-green-600", text: "text-green-700", bg: "bg-green-50 border-green-200", label: "On track" },
  amber: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Watch" },
  red: { dot: "bg-red-700", text: "text-red-700", bg: "bg-red-50 border-red-200", label: "Action needed" },
  grey: { dot: "bg-gray-400", text: "text-gray-500", bg: "bg-gray-50 border-gray-200", label: "No data" },
};

export const ZONE_COLORS: Record<string, string> = {
  Negative: "#7f1d1d",
  "Out of Stock": "#b91c1c",
  Critical: "#f59e0b",
  Healthy: "#15803d",
  Overstock: "#1d4ed8",
};

/** Formats pack quantities in the user's selected unit (MC / KG / Tons). */
export function usePerfFormat() {
  const { formatVal, unitLabel, convertVal } = useUnit();
  const fmtMc = (v: number | null | undefined, decimals?: number) => (v === null || v === undefined ? "–" : formatVal(v, decimals));
  const fmtMcSigned = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatVal(Math.abs(v))}`);
  const fmtPct = (v: number | null | undefined, decimals = 1) => (v === null || v === undefined ? "–" : `${v.toFixed(decimals)}%`);
  const fmtPctSigned = (v: number | null | undefined, decimals = 1) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(decimals)}%`);
  const fmtWeeks = (v: number | null | undefined) => (v === null || v === undefined ? "∞" : `${v.toFixed(1)} wks`);
  const fmtUsd = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `$${Math.round(v).toLocaleString("en-US")}`);
  const fmtValue = (v: number | null | undefined, unit: KpiUnit) => {
    if (v === null || v === undefined) return "–";
    switch (unit) {
      case "MC":
        return fmtMc(v);
      case "pct":
        return fmtPct(v);
      case "weeks":
        return fmtWeeks(v);
      case "usd":
        return fmtUsd(v);
      case "days":
        return `${Math.round(v)} days`;
      default:
        return v.toLocaleString("en-US");
    }
  };
  const unitFor = (unit: KpiUnit) => (unit === "MC" ? unitLabel : unit === "pct" ? "%" : unit === "weeks" ? "weeks" : unit === "usd" ? "USD" : unit === "days" ? "days" : "SKUs");
  /** Recharts tick/tooltip formatter for MC axes. */
  const axisMc = (v: number) => formatVal(v, 0);
  return { fmtMc, fmtMcSigned, fmtPct, fmtPctSigned, fmtWeeks, fmtUsd, fmtValue, unitFor, unitLabel, convertVal, axisMc };
}

export function RagDot({ status, className }: { status: Rag; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", RAG_STYLES[status].dot, className)} aria-label={RAG_STYLES[status].label} />;
}

export function RagBadge({ status, text }: { status: Rag; text?: string }) {
  const s = RAG_STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", s.bg, s.text)}>
      <RagDot status={status} />
      {text ?? s.label}
    </span>
  );
}

export function DeltaChip({ delta, label, invert = false, unit = "MC" }: { delta: Delta | null; label: string; invert?: boolean; unit?: KpiUnit }) {
  const { fmtMcSigned, fmtPctSigned } = usePerfFormat();
  if (!delta || delta.delta === null) {
    return (
      <span className="text-xs text-muted-foreground" title={delta?.note}>
        {label}: {delta?.note ?? "Not available"}
      </span>
    );
  }
  const good = invert ? delta.delta <= 0 : delta.delta >= 0;
  const amount = unit === "MC" ? fmtMcSigned(delta.delta) : unit === "pct" || unit === "weeks" ? `${delta.delta > 0 ? "+" : delta.delta < 0 ? "−" : ""}${Math.abs(delta.delta).toFixed(1)}${unit === "pct" ? " pts" : " wks"}` : `${delta.delta > 0 ? "+" : ""}${delta.delta}`;
  return (
    <span className={cn("text-xs font-medium", good ? "text-green-700" : "text-red-700")}>
      {label}: {amount}
      {delta.pct !== null && unit === "MC" ? ` (${fmtPctSigned(delta.pct)})` : ""}
    </span>
  );
}

/** Tiny inline sparkline (SVG, no axes). */
export function Sparkline({ points, color = PERF_COLORS.accent, height = 28, width = 120, className }: { points: SparkPoint[]; color?: string; height?: number; width?: number; className?: string }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) return <div className={cn("text-[10px] text-muted-foreground", className)} style={{ height }}>No trend yet</div>;
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = width / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => (p.value === null ? null : [i * step, height - 2 - ((p.value - min) / range) * (height - 4)] as const));
  let d = "";
  let pen = false;
  for (const c of coords) {
    if (!c) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${c[0].toFixed(1)},${c[1].toFixed(1)} `;
    pen = true;
  }
  const last = [...coords].reverse().find((c) => c !== null);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible", className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2} fill={color} />}
    </svg>
  );
}

/** A chart/table block whose title is the business question it answers. */
export function QuestionCard({ question, hint, children, className, actions, id }: { question: string; hint?: string; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  return (
    <Card id={id} className={cn("perf-card break-inside-avoid", className)}>
      <CardHeader className="pb-2 flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-semibold leading-snug">{question}</CardTitle>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ message, className }: { message: string; className?: string }) {
  return <div className={cn("flex items-center justify-center rounded-md border border-dashed py-8 text-sm text-muted-foreground", className)}>{message}</div>;
}

export function SectionNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-muted-foreground list-disc pl-4 print:mt-2">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}

/** Section wrapper used by the page and by presentation mode. */
export function SectionFrame({ id, number, title, subtitle, children }: { id: string; number: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} data-perf-section={id} className="perf-section scroll-mt-40 space-y-4">
      <header className="flex items-baseline gap-3 border-b border-[#7f1d1d]/30 pb-2">
        <span className="text-xs font-bold tracking-widest text-[#7f1d1d]">{String(number).padStart(2, "0")}</span>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

export function StatusText({ status, children }: { status: Rag; children: ReactNode }) {
  return <span className={cn("font-medium", RAG_STYLES[status].text)}>{children}</span>;
}
