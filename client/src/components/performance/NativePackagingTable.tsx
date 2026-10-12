import { usePerfFormat } from "./shared";

type Kind = "quantity" | "percent" | "usd" | "weeks" | "number" | "text";
type Column = { key: string; label: string; kind?: Kind };
const cell = "whitespace-nowrap border-t border-border/70 px-3 py-2 text-xs";

function read(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, row);
}

/** Renders a dedicated server group calculation. This deliberately does not infer metrics from IMS. */
export default function NativePackagingTable({ title, rows, columns }: { title: string; rows?: unknown[]; columns: Column[] }) {
  const { fmtMc, fmtPct, fmtUsd, fmtWeeks } = usePerfFormat();
  if (!rows?.length) return null;
  const format = (value: unknown, kind: Kind = "text") => {
    if (value == null) return "—";
    if (kind === "quantity") return fmtMc(Number(value));
    if (kind === "percent") return fmtPct(Number(value));
    if (kind === "usd") return fmtUsd(Number(value));
    if (kind === "weeks") return fmtWeeks(Number(value));
    return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(value);
  };
  return <div className="overflow-x-auto rounded-md border border-[#8c552f]/20 bg-[#fcf8f1]">
    <div className="border-b border-[#8c552f]/15 px-3 py-2 text-xs font-bold text-[#68452e]">{title}</div>
    <table className="w-full min-w-max text-left">
      <thead><tr className="bg-[#f3e9d9] text-[10px] font-bold uppercase tracking-wide text-[#68452e]">{columns.map((column, index) => <th key={column.key} className={`px-3 py-2 ${index === 0 ? "sticky left-0 bg-[#f3e9d9]" : ""} ${column.kind ? "text-right" : ""}`}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((item, index) => {
        const row = item as Record<string, unknown>;
        return <tr key={String(row.group ?? row.packaging ?? row.weight ?? row.label ?? index)} className="odd:bg-white/70">
          {columns.map((column, columnIndex) => {
            const value = column.key === "group" ? (row.group ?? row.packaging) : column.key === "packaging" ? (row.packaging ?? row.group) : read(row, column.key);
            return <td key={column.key} className={`${cell} ${columnIndex === 0 ? "sticky left-0 z-[1] bg-inherit font-semibold" : ""} ${column.kind ? "text-right tabular-nums" : ""}`}>{format(value, column.kind)}</td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
