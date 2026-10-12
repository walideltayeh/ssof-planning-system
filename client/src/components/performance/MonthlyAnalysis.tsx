import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { Download, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnit } from "@/contexts/UnitContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { MonthlyAnalysis as MonthlyAnalysisData, MonthlyRow } from "@shared/performance/monthlyAnalysis";
import type { PerformanceRequest } from "./types";

type Input = PerformanceRequest & { refresh?: true };
type Cell = string | number | null;
type Column<T> = { key: string; label: string; value: (row: T) => Cell; format?: (row: T) => string; kind?: "quantity" | "mc" | "percent" | "weeks" | "index"; cellClass?: (row: T) => string };

const frame = "overflow-hidden rounded-lg border border-[#7f1d1d]/20 bg-card shadow-sm";
const headCell = "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-[#f3e9e7] px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#632229]";
const numericHead = `${headCell} text-right`;
const bodyCell = "whitespace-nowrap border-b border-border/70 px-3 py-2 text-xs";
const numericCell = `${bodyCell} text-right tabular-nums`;

function shown(value: number | null | undefined, decimals = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function calendarMonth(month: number) {
  return new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2020, month - 1, 1));
}

function ExcelExport<T>({ title, columns, rows, unit, convertVal }: { title: string; columns: Column<T>[]; rows: T[]; unit: string; convertVal: (v: number) => number }) {
  const download = async () => {
    let url: string | undefined;
    try {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet(title.slice(0, 31));
      sheet.addRow(columns.map((column) => `${column.label}${column.kind === "quantity" ? ` (${unit})` : column.kind === "mc" && !column.label.includes("(MC)") ? " (MC)" : ""}`));
      sheet.getRow(1).font = { bold: true, color: { argb: "FF632229" } };
      rows.forEach((row) => sheet.addRow(columns.map((column) => {
        const value = column.value(row);
        return column.kind === "quantity" && typeof value === "number" ? convertVal(value) : value;
      })));
      sheet.columns.forEach((column) => { column.width = Math.min(34, Math.max(12, ...sheet.getColumn(column.number!).values.map((v) => String(v ?? "").length + 2))); });
      sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
      const buffer = await book.xlsx.writeBuffer();
      url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${unit}.xlsx`;
      link.click();
    } catch (error) {
      toast.error(`Could not export ${title}: ${error instanceof Error ? error.message : "unexpected download error"}`);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };
  return <button type="button" onClick={() => void download()} className="inline-flex items-center gap-1.5 rounded border border-[#7f1d1d]/20 bg-background px-2.5 py-1.5 text-xs font-semibold text-[#7f1d1d] hover:bg-[#7f1d1d]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f1d1d]"><Download className="h-3.5 w-3.5" aria-hidden />Export Excel</button>;
}

function SortableTable<T>({ title, columns, rows, unit, convertVal, empty = "No values are available for this selection.", rowKey, initialSort }: {
  title: string; columns: Column<T>[]; rows: T[]; unit: string; convertVal: (v: number) => number; empty?: string; rowKey: (row: T) => string; initialSort?: string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: initialSort ?? columns[0]?.key ?? "", direction: "asc" });
  const sorted = useMemo(() => {
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const aTotal = typeof a === "object" && a !== null && "total" in a && Boolean((a as { total?: boolean }).total);
      const bTotal = typeof b === "object" && b !== null && "total" in b && Boolean((b as { total?: boolean }).total);
      if (aTotal !== bTotal) return aTotal ? 1 : -1;
      const av = column.value(a); const bv = column.value(b);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [columns, rows, sort]);
  const sortBy = (column: Column<T>) => setSort((old) => ({ key: column.key, direction: old.key === column.key && old.direction === "asc" ? "desc" : "asc" }));
  return <section className={frame} aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <ExcelExport title={title} columns={columns} rows={sorted} unit={unit} convertVal={convertVal} />
    </div>
    {!rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p> : <div className="max-h-[70vh] overflow-auto">
      <table className="w-full min-w-max border-collapse" aria-label={title}>
        <thead><tr>{columns.map((column, index) => {
          const active = sort.key === column.key;
          return <th key={column.key} scope="col" aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className={`${index === 0 ? "sticky left-0 z-20 min-w-44 bg-[#f3e9e7]" : ""} ${column.kind ? numericHead : headCell}`}>
            <button type="button" onClick={() => sortBy(column)} className={`inline-flex items-center gap-1 ${column.kind ? "ml-auto" : ""} rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f1d1d]`}>
              {column.label}{column.kind === "quantity" ? ` (${unit})` : ""}{active ? sort.direction === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />}
            </button>
          </th>;
        })}</tr></thead>
        <tbody>{sorted.map((row) => <tr key={rowKey(row)} className="odd:bg-background even:bg-[#f7f2f0]/70 hover:bg-[#f5e9e5]">
          {columns.map((column, index) => <td key={column.key} className={`${column.kind ? numericCell : bodyCell} ${index === 0 ? "sticky left-0 z-[1] bg-inherit font-semibold text-foreground" : ""} ${column.cellClass?.(row) ?? ""}`}>
            {column.format ? column.format(row) : (() => {
              const value = column.value(row);
              return typeof value === "number" ? shown(value) : value ?? "—";
            })()}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

function skuLabel(row: MonthlyRow) { return `${row.sku} · ${row.weight}`; }
function skuDisplay(row: MonthlyRow) { return `${skuLabel(row)}${row.total ? " total" : ""}`; }
function identityColumns<T extends MonthlyRow>(): Column<T>[] {
  return [
    { key: "sku", label: "SKU · weight", value: (r) => skuDisplay(r) },
    { key: "category", label: "Category", value: (r) => r.category },
    { key: "flavour", label: "Flavour", value: (r) => r.flavour },
  ];
}
const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${shown(value)}%`;
const qty = (value: number | null | undefined, formatVal: (v: number, d?: number) => string) => value == null ? "—" : formatVal(value);

function skuKeys(row: MonthlyRow) { return row.id; }

function Content({ data }: { data: MonthlyAnalysisData }) {
  const { formatVal, unitLabel, convertVal } = useUnit();
  const rows = data.rows;
  const totals = data.totals;
  const allSku = (source: MonthlyRow[]) => [...source, ...totals];
  const rateCols: Column<MonthlyRow>[] = [
    ...identityColumns(),
    ...([3, 6, 12] as const).map((n) => ({ key: `avg${n}`, label: `${n} month avg`, value: (r: MonthlyRow) => r.rates[`avg${n}`], kind: "quantity" as const, format: (r: MonthlyRow) => qty(r.rates[`avg${n}`], formatVal) })),
    { key: "last", label: "Latest IMS", value: (r) => r.rates.last, kind: "quantity", format: (r) => `${qty(r.rates.last, formatVal)}${r.rates.lastMonth ? ` · ${r.rates.lastMonth}` : ""}` },
    { key: "trendPct", label: "vs prior 3 (%)", value: (r) => r.rates.trendPct, kind: "percent", format: (r) => pct(r.rates.trendPct) },
    { key: "direction", label: "Trend", value: (r) => r.rates.direction },
  ];
  const stockCols: Column<MonthlyRow>[] = [
    ...identityColumns(),
    { key: "closing", label: "Closing stock", value: (r) => r.stock.closing, kind: "quantity", format: (r) => qty(r.stock.closing, formatVal) },
    { key: "weeks", label: "Cover", value: (r) => r.stock.weeks, kind: "weeks", format: (r) => r.stock.weeks == null ? "∞" : `${shown(r.stock.weeks)} wks` },
    { key: "zone", label: "Zone", value: (r) => r.stock.zone },
    { key: "target", label: "Cover target", value: () => "4–6 weeks" },
  ];
  const gridCols: Column<MonthlyRow>[] = [
    ...identityColumns(),
    ...data.gridMonths.map((month, index) => ({ key: month.key, label: month.label, value: (r: MonthlyRow) => r.ims[index], kind: "quantity" as const, format: (r: MonthlyRow) => qty(r.ims[index], formatVal), cellClass: (r: MonthlyRow) => {
      const valid = r.ims.filter((value): value is number => value != null);
      if (valid.length < 2 || r.ims[index] == null || Math.max(...valid) === Math.min(...valid)) return "";
      if (r.ims[index] === Math.max(...valid)) return "bg-emerald-100/70 font-semibold text-emerald-950";
      if (r.ims[index] === Math.min(...valid)) return "bg-rose-100/70 font-semibold text-rose-950";
      return "";
    } })),
    { key: "imsTotal", label: "24-mo total", value: (r) => r.imsTotal, kind: "quantity", format: (r) => qty(r.imsTotal, formatVal) },
  ];
  const seasonRows = data.seasonality.flatMap((group) => group.months.map((item) => ({
    key: `${group.group}-${item.month}`, group: group.group, month: item.month, index: item.index, years: item.years,
    ramadan: item.ramadanYears.join(", ") || "—", summer: item.summer ? "Summer" : "—",
  })));
  type SeasonRow = typeof seasonRows[number];
  const seasonCols: Column<SeasonRow>[] = [
    { key: "group", label: "Country · weight", value: (r) => r.group },
    { key: "month", label: "Month", value: (r) => r.month, format: (r) => calendarMonth(r.month) },
    { key: "index", label: "Seasonality index", value: (r) => r.index, kind: "index", format: (r) => r.index == null ? "—" : `${shown(r.index, 2)}×` },
    { key: "years", label: "Years", value: (r) => r.years, kind: "index", format: (r) => shown(r.years, 0) },
    { key: "ramadan", label: "Ramadan years", value: (r) => r.ramadan },
    { key: "summer", label: "Calendar note", value: (r) => r.summer },
  ];
  const yoyRows = allSku(rows).flatMap((row) => row.yoy.map((entry) => ({ row, entry, key: `${row.id}-${entry.month.key}` })));
  type YoyRow = typeof yoyRows[number];
  const yoyCols: Column<YoyRow>[] = [
    { key: "sku", label: "SKU · weight", value: (r) => skuDisplay(r.row) },
    { key: "month", label: "Month", value: (r) => r.entry.month.key, format: (r) => r.entry.month.label },
    { key: "current", label: "Current", value: (r) => r.entry.current, kind: "quantity", format: (r) => qty(r.entry.current, formatVal) },
    { key: "prior", label: "Prior year", value: (r) => r.entry.prior, kind: "quantity", format: (r) => qty(r.entry.prior, formatVal) },
    { key: "growthPct", label: "Growth (%)", value: (r) => r.entry.growthPct, kind: "percent", format: (r) => pct(r.entry.growthPct) },
    { key: "cumulativeCurrent", label: "Current YTD", value: (r) => r.entry.cumulativeCurrent, kind: "quantity", format: (r) => qty(r.entry.cumulativeCurrent, formatVal) },
    { key: "cumulativePrior", label: "Prior YTD", value: (r) => r.entry.cumulativePrior, kind: "quantity", format: (r) => qty(r.entry.cumulativePrior, formatVal) },
    { key: "cumulativeGrowthPct", label: "Cumulative growth (%)", value: (r) => r.entry.cumulativeGrowthPct, kind: "percent", format: (r) => pct(r.entry.cumulativeGrowthPct) },
  ];
  const volatilityCols: Column<MonthlyRow>[] = [
    ...identityColumns(),
    { key: "months", label: "Months", value: (r) => r.volatility.months, kind: "index" },
    { key: "mean", label: "Mean IMS", value: (r) => r.volatility.mean, kind: "quantity", format: (r) => qty(r.volatility.mean, formatVal) },
    { key: "stdDev", label: "Std dev", value: (r) => r.volatility.stdDev, kind: "quantity", format: (r) => qty(r.volatility.stdDev, formatVal) },
    { key: "cvPct", label: "CV (%)", value: (r) => r.volatility.cvPct, kind: "percent", format: (r) => pct(r.volatility.cvPct) },
    { key: "label", label: "Volatility", value: (r) => r.volatility.label },
  ];
  const comparisonRows = allSku(rows).flatMap((row) => row.comparison.map((entry) => ({ row, entry, key: `${row.id}-${entry.month.key}` })));
  type ComparisonRow = typeof comparisonRows[number];
  const comparisonCols: Column<ComparisonRow>[] = [
    { key: "sku", label: "SKU · weight", value: (r) => skuDisplay(r.row) },
    { key: "month", label: "Month", value: (r) => r.entry.month.key, format: (r) => r.entry.month.label },
    { key: "forecast", label: "Entered forecast", value: (r) => r.entry.forecast, kind: "quantity", format: (r) => qty(r.entry.forecast, formatVal) },
    { key: "actual", label: "Actual IMS", value: (r) => r.entry.actual, kind: "quantity", format: (r) => qty(r.entry.actual, formatVal) },
    { key: "gap", label: "Gap", value: (r) => r.entry.gap, kind: "quantity", format: (r) => qty(r.entry.gap, formatVal) },
    { key: "gapPct", label: "Gap %", value: (r) => r.entry.gapPct, kind: "percent", format: (r) => pct(r.entry.gapPct) },
    { key: "biasLabel", label: "Forecast pattern", value: (r) => r.row.bias.label },
    { key: "bias", label: "Habitual bias (%)", value: (r) => r.row.bias.gapPct, kind: "percent", format: (r) => pct(r.row.bias.gapPct) },
    { key: "biasMonths", label: "Bias months", value: (r) => r.row.bias.months, kind: "index" },
  ];
  const suggestionRows = allSku(rows).flatMap((row) => row.suggestions.map((entry) => ({ row, entry, key: `${row.id}-${entry.month.key}` })));
  type SuggestionRow = typeof suggestionRows[number];
  const suggestionCols: Column<SuggestionRow>[] = [
    { key: "sku", label: "SKU · weight", value: (r) => skuDisplay(r.row) },
    { key: "month", label: "Month", value: (r) => r.entry.month.label },
    { key: "suggested", label: "Suggested", value: (r) => r.entry.suggested, kind: "quantity", format: (r) => qty(r.entry.suggested, formatVal) },
    { key: "current", label: "Entered forecast", value: (r) => r.entry.current, kind: "quantity", format: (r) => qty(r.entry.current, formatVal) },
    { key: "differenceMc", label: "Difference (MC)", value: (r) => r.entry.differenceMc, kind: "mc", format: (r) => r.entry.differenceMc == null ? "—" : `${shown(r.entry.differenceMc)} MC`, cellClass: (r) => r.entry.material ? "bg-amber-100 text-amber-950 font-bold" : "" },
    { key: "differencePct", label: "Difference %", value: (r) => r.entry.differencePct, kind: "percent", format: (r) => pct(r.entry.differencePct), cellClass: (r) => r.entry.material ? "bg-amber-100 text-amber-950 font-bold" : "" },
    { key: "material", label: "Material", value: (r) => r.entry.material ? "Flagged" : "—", cellClass: (r) => r.entry.material ? "bg-amber-100 text-amber-950 font-bold" : "" },
    { key: "available", label: "Forecast period", value: (r) => r.entry.availablePeriod ? "Available" : "Unavailable" },
    { key: "currentClosing", label: "Stock: current path", value: (r) => r.entry.currentClosing, kind: "quantity", format: (r) => qty(r.entry.currentClosing, formatVal) },
    { key: "suggestedClosing", label: "Stock: suggested path", value: (r) => r.entry.suggestedClosing, kind: "quantity", format: (r) => qty(r.entry.suggestedClosing, formatVal) },
    { key: "currentCover", label: "Cover: current", value: (r) => r.entry.currentCover, kind: "weeks", format: (r) => r.entry.currentCover == null ? "—" : `${shown(r.entry.currentCover)} wks` },
    { key: "suggestedCover", label: "Cover: suggested", value: (r) => r.entry.suggestedCover, kind: "weeks", format: (r) => r.entry.suggestedCover == null ? "—" : `${shown(r.entry.suggestedCover)} wks` },
    { key: "seasonalityYears", label: "History years", value: (r) => r.entry.seasonalityYears, kind: "index" },
  ];
  const panels = [
    { id: "ims-running-rate", title: "01 · IMS Running Rate", hint: "3 / 6 / 12 month rates, latest month and trend against the preceding three months.", table: <SortableTable title="IMS Running Rate" columns={rateCols} rows={allSku(rows)} unit={unitLabel} convertVal={convertVal} rowKey={skuKeys} /> },
    { id: "stock-levels", title: "02 · Stock Levels", hint: "Default order follows the server's tightest-cover-first planner sequence; totals come from the calculation payload.", table: <SortableTable title="Stock Levels" columns={stockCols} rows={allSku(rows)} unit={unitLabel} convertVal={convertVal} rowKey={skuKeys} initialSort="weeks" /> },
    { id: "ims-matrix", title: "03 · 24-month IMS matrix", hint: "Per-row strongest and weakest populated months are shaded; totals are supplied by the analysis calculation.", table: <SortableTable title="24-month IMS matrix" columns={gridCols} rows={allSku(rows)} unit={unitLabel} convertVal={convertVal} rowKey={skuKeys} /> },
    { id: "seasonality", title: "04 · Seasonality calendar", hint: "Country and weight monthly indexes, history depth, Ramadan years and summer markers.", table: <SortableTable title="Seasonality calendar" columns={seasonCols} rows={seasonRows} unit={unitLabel} convertVal={convertVal} rowKey={(r: SeasonRow) => r.key} /> },
    { id: "year-over-year", title: "05 · Year-on-year", hint: "Monthly and cumulative current/prior values and growth, as calculated by the analysis service.", table: <SortableTable title="Year-on-year" columns={yoyCols} rows={yoyRows} unit={unitLabel} convertVal={convertVal} rowKey={(r: YoyRow) => r.key} /> },
    { id: "volatility", title: "06 · Volatility", hint: "Variation across observed IMS months; null CV means there is not enough usable history.", table: <SortableTable title="Volatility" columns={volatilityCols} rows={allSku(rows)} unit={unitLabel} convertVal={convertVal} rowKey={skuKeys} /> },
    { id: "forecast-actual", title: "07 · Forecast vs actual", hint: "Entered forecast compared with actual IMS. Habitual bias excludes auto-generated IMS.", table: <SortableTable title="Forecast vs actual" columns={comparisonCols} rows={comparisonRows} unit={unitLabel} convertVal={convertVal} rowKey={(r: ComparisonRow) => r.key} /> },
    { id: "next-six", title: "08 · Next 6 suggestions", hint: `Read-only planner suggestions. Material threshold: ${shown(data.materialThresholdPct)}%. Differences are always shown in MC; stock quantities follow the selected unit.`, table: <SortableTable title="Next 6 suggestions" columns={suggestionCols} rows={suggestionRows} unit={unitLabel} convertVal={convertVal} rowKey={(r: SuggestionRow) => r.key} /> },
  ];
  return <div className="space-y-5">
    <header className="rounded-lg border border-[#7f1d1d]/20 bg-[#7f1d1d]/[0.035] px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#7f1d1d]">Planner workspace · {data.country}</p><h2 className="mt-1 text-xl font-bold">Monthly Analysis</h2></div>
        <p className="text-xs text-muted-foreground">As of {data.asOf || "not recorded"} <span className="mx-1">·</span>{data.windowLabel} <span className="mx-1">·</span>Quantities: {unitLabel}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Missing values are shown as —. In suggestion paths, a null cover means unknown when the planning calendar or demand denominator is unavailable/zero; it does not mean infinite cover. Seasonality and suggestions reflect the available history shown in each row. All calculations are read-only and retain the active page filters.</p>
    </header>
    {panels.map((panel) => <section key={panel.id} id={panel.id} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#7f1d1d]/20 pb-1.5"><h2 className="text-base font-bold">{panel.title}</h2><p className="text-xs text-muted-foreground">{panel.hint}</p></div>
      {panel.table}
    </section>)}
    <div className="rounded-lg border border-border bg-muted/35 px-4 py-3 text-xs text-muted-foreground"><strong className="text-foreground">Data notes.</strong> {data.notes.length ? data.notes.join(" ") : "Nulls indicate missing or insufficient source data, not zero. History and confidence are disclosed in the relevant year and suggestion rows."}</div>
  </div>;
}

export default function MonthlyAnalysis({ input }: { input: Input }) {
  const query = trpc.country.monthlyAnalysis.useQuery(input);
  if (query.isLoading && !query.data) return <div className="space-y-4" aria-label="Loading monthly analysis">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>;
  if (query.error && !query.data) return <Alert variant="destructive"><AlertTitle>Monthly analysis could not be loaded</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>;
  if (!query.data) return <div className="rounded-lg border border-dashed border-[#7f1d1d]/30 bg-[#7f1d1d]/[0.025] px-5 py-10 text-center"><h2 className="font-semibold">No monthly analysis data</h2><p className="mt-1 text-sm text-muted-foreground">There is no calculated monthly planner data for this country and selection.</p></div>;
  return <Content data={query.data} />;
}
