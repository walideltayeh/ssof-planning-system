import type { CompareMode, PerformanceFilters, PerformanceMeta, PeriodPreset } from "./types";
import { formatUpdateTime } from "@/hooks/useLastUpdates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, FileDown, FileSpreadsheet, ListOrdered, MonitorPlay, RefreshCw } from "lucide-react";

const PRESETS: Array<[PeriodPreset, string]> = [
  ["month", "Month"],
  ["qtd", "Quarter to date"],
  ["ytd", "Year to date"],
  ["l12m", "Last 12 months"],
  ["custom", "Custom"],
];
const COMPARES: Array<[CompareMode, string]> = [["plan", "Plan"], ["ly", "Last year"], ["prev", "Previous period"]];

function monthValue(period: { year: number; month: number }) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function LabeledSelect({ label, value, onValueChange, items, className }: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: Array<[string, string]>;
  className?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger size="sm" className={className}><SelectValue /></SelectTrigger>
        <SelectContent>{items.map(([itemValue, itemLabel]) => <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}

function MultiFilter({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          {label}{selected.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5">{selected.length}</Badge>}
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{label}</p>
          {selected.length > 0 && <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange([])}>Clear</Button>}
        </div>
        {options.length === 0 ? <p className="text-sm text-muted-foreground">No options available</p> : (
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {options.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(option)}
                  onCheckedChange={(checked) => onChange(checked ? [...selected, option] : selected.filter((value) => value !== option))}
                />
                {option}
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export interface PerformanceHeaderProps {
  preset: PeriodPreset;
  anchor?: string;
  from?: string;
  to?: string;
  compare: CompareMode;
  filters: PerformanceFilters;
  meta?: PerformanceMeta;
  /** "Last update <time> by <user>" for the selected country; undefined while loading. */
  lastUpdateText?: string;
  isRefreshing: boolean;
  onPresetChange: (value: PeriodPreset) => void;
  onAnchorChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onCompareChange: (value: CompareMode) => void;
  onFiltersChange: (value: PerformanceFilters) => void;
  onRefresh: () => void;
  onPresentation: () => void;
  onArrangeSlides: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
}

export default function PerformanceHeader(props: PerformanceHeaderProps) {
  const periods = (props.meta?.availablePeriods ?? []).filter((period) => !props.meta?.currentPeriod || period.id <= props.meta.currentPeriod.id);
  const periodItems: Array<[string, string]> = periods.map((period) => [monthValue(period), period.label]);
  const shownAnchor = props.anchor ?? (props.meta ? monthValue(props.meta.window.to) : "");
  const shownFrom = props.from ?? (props.meta ? monthValue(props.meta.window.from) : "");
  const shownTo = props.to ?? (props.meta ? monthValue(props.meta.window.to) : "");

  return (
    <div className="perf-no-print sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-end gap-2">
        <LabeledSelect label="Period" value={props.preset} onValueChange={(value) => props.onPresetChange(value as PeriodPreset)} items={PRESETS} className="min-w-36" />
        {shownAnchor && props.preset !== "custom" && <LabeledSelect label="Ending month" value={shownAnchor} onValueChange={props.onAnchorChange} items={periodItems} className="min-w-36" />}
        {props.preset === "custom" && shownFrom && shownTo && (
          <>
            <LabeledSelect label="From" value={shownFrom} onValueChange={props.onFromChange} items={periodItems} className="min-w-36" />
            <LabeledSelect label="To" value={shownTo} onValueChange={props.onToChange} items={periodItems} className="min-w-36" />
          </>
        )}
        <LabeledSelect label="Compare vs" value={props.compare} onValueChange={(value) => props.onCompareChange(value as CompareMode)} items={COMPARES} className="min-w-32" />
        <MultiFilter label="Weight" options={props.meta?.filterOptions.weights ?? []} selected={props.filters.weights ?? []} onChange={(weights) => props.onFiltersChange({ ...props.filters, weights })} />
        <MultiFilter label="Category" options={props.meta?.filterOptions.categories ?? []} selected={props.filters.categories ?? []} onChange={(categories) => props.onFiltersChange({ ...props.filters, categories })} />
        <MultiFilter label="Packaging" options={props.meta?.filterOptions.packaging ?? []} selected={props.filters.packaging ?? []} onChange={(packaging) => props.onFiltersChange({ ...props.filters, packaging })} />
        <MultiFilter label="Flavour" options={props.meta?.filterOptions.flavours ?? []} selected={props.filters.flavours ?? []} onChange={(flavours) => props.onFiltersChange({ ...props.filters, flavours })} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">Data as of {props.meta?.dataAsOf ? formatUpdateTime(props.meta.dataAsOf) : "not recorded"}{props.lastUpdateText ? ` · ${props.lastUpdateText}` : ""}</span>
        <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.isRefreshing}><RefreshCw className={props.isRefreshing ? "animate-spin" : ""} />Refresh</Button>
        <Button variant="outline" size="sm" onClick={props.onPresentation}><MonitorPlay />Presentation Mode</Button>
        <Button variant="outline" size="sm" onClick={props.onArrangeSlides}><ListOrdered />Arrange slides</Button>
        <Button variant="outline" size="sm" onClick={props.onExportPdf}><FileDown />Export PDF</Button>
        <Button variant="outline" size="sm" onClick={props.onExportExcel}><FileSpreadsheet />Export Excel</Button>
      </div>
    </div>
  );
}