import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Period {
  id: number;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

interface Sku {
  id: number;
  name: string;
  weight: string;
  sortOrder: number;
  isExcludedFromTotal: boolean | null;
}

interface DataGridProps {
  title: string;
  skus: Sku[];
  periods: Period[];
  getData: (skuId: number, periodId: number) => string;
  onCellEdit?: (skuId: number, periodId: number, value: string) => void;
  showWeight?: boolean;
  showYearTotals?: boolean;
  excludedSkuIds?: Set<number>;
  onToggleExclude?: (skuId: number) => void;
  showExcludeCheckbox?: boolean;
  highlightActual?: (skuId: number, periodId: number) => boolean;
}

export default function DataGrid({
  title,
  skus,
  periods,
  getData,
  onCellEdit,
  showWeight = true,
  showYearTotals = true,
  excludedSkuIds = new Set(),
  onToggleExclude,
  showExcludeCheckbox = false,
  highlightActual,
}: DataGridProps) {
  const [editingCell, setEditingCell] = useState<{ skuId: number; periodId: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback((skuId: number, periodId: number, currentValue: string) => {
    if (!onCellEdit) return;
    setEditingCell({ skuId, periodId });
    setEditValue(currentValue === "0" ? "" : currentValue);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onCellEdit]);

  const handleSave = useCallback(() => {
    if (editingCell && onCellEdit) {
      onCellEdit(editingCell.skuId, editingCell.periodId, editValue || "0");
    }
    setEditingCell(null);
  }, [editingCell, editValue, onCellEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditingCell(null);
  }, [handleSave]);

  // Group periods by year
  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  // Calculate totals
  const getYearTotal = (skuId: number, year: number) => {
    const yearPeriods = periods.filter(p => p.year === year);
    return yearPeriods.reduce((sum, p) => {
      const val = parseFloat(getData(skuId, p.id)) || 0;
      return sum + val;
    }, 0);
  };

  const getColumnTotal = (periodId: number) => {
    return skus
      .filter(s => !excludedSkuIds.has(s.id))
      .reduce((sum, sku) => {
        const val = parseFloat(getData(sku.id, periodId)) || 0;
        return sum + val;
      }, 0);
  };

  const getYearColumnTotal = (year: number) => {
    return skus
      .filter(s => !excludedSkuIds.has(s.id))
      .reduce((sum, sku) => sum + getYearTotal(sku.id, year), 0);
  };

  const formatNumber = (val: number) => {
    if (val === 0) return "-";
    return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                {showExcludeCheckbox && <th className="sticky left-0 bg-muted/50 z-10 px-1 py-2 w-8"></th>}
                {showWeight && <th className="sticky left-0 bg-muted/50 z-10 px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[50px]">Weight</th>}
                <th className={`${showWeight ? '' : 'sticky left-0 z-10 bg-muted/50'} px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[180px]`}>SKU Name</th>
                {periodsByYear.map(({ year, periods: yPeriods }) => (
                  <th key={`year-group-${year}`} colSpan={yPeriods.length + (showYearTotals ? 1 : 0)} className="px-2 py-1 text-center font-semibold border-l border-border">
                    {year}
                  </th>
                ))}
              </tr>
              <tr className="bg-muted/30 border-b">
                {showExcludeCheckbox && <th className="sticky left-0 bg-muted/30 z-10 px-1 py-1"></th>}
                {showWeight && <th className="sticky left-0 bg-muted/30 z-10 px-2 py-1"></th>}
                <th className={`${showWeight ? '' : 'sticky left-0 z-10 bg-muted/30'} px-2 py-1`}></th>
                {periodsByYear.map(({ year, periods: yPeriods }) => (
                  <>
                    {yPeriods.map(p => (
                      <th key={p.id} className="px-2 py-1 text-center font-medium text-muted-foreground whitespace-nowrap min-w-[65px]">
                        {p.label.split(' ')[0]}
                      </th>
                    ))}
                    {showYearTotals && (
                      <th key={`total-${year}`} className="px-2 py-1 text-center font-semibold text-foreground whitespace-nowrap min-w-[75px] border-l border-border bg-muted/50">
                        Total
                      </th>
                    )}
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {skus.map((sku, idx) => (
                <tr key={sku.id} className={`border-b hover:bg-muted/20 ${idx % 2 === 0 ? '' : 'bg-muted/5'}`}>
                  {showExcludeCheckbox && (
                    <td className="sticky left-0 bg-background z-10 px-1 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={excludedSkuIds.has(sku.id)}
                        onChange={() => onToggleExclude?.(sku.id)}
                        className="h-3 w-3"
                      />
                    </td>
                  )}
                  {showWeight && (
                    <td className="sticky left-0 bg-background z-10 px-2 py-1.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                        sku.weight === '250g' ? 'bg-green-100 text-green-700' :
                        'bg-orange-100 text-orange-700'
                      }`}>
                        {sku.weight}
                      </span>
                    </td>
                  )}
                  <td className={`${showWeight ? '' : 'sticky left-0 z-10 bg-background'} px-2 py-1.5 font-medium whitespace-nowrap`}>
                    {sku.name}
                  </td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => (
                    <>
                      {yPeriods.map(p => {
                        const value = getData(sku.id, p.id);
                        const isEditing = editingCell?.skuId === sku.id && editingCell?.periodId === p.id;
                        const isActual = highlightActual?.(sku.id, p.id);
                        return (
                          <td
                            key={`${sku.id}-${p.id}`}
                            className={`px-1 py-1.5 text-right tabular-nums whitespace-nowrap ${
                              onCellEdit ? 'cursor-pointer hover:bg-blue-50' : ''
                            } ${isActual ? 'bg-green-50 font-medium' : ''}`}
                            onDoubleClick={() => handleDoubleClick(sku.id, p.id, value)}
                          >
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                type="text"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={handleSave}
                                onKeyDown={handleKeyDown}
                                className="w-full h-6 px-1 text-right text-xs border rounded bg-white"
                              />
                            ) : (
                              formatNumber(parseFloat(value) || 0)
                            )}
                          </td>
                        );
                      })}
                      {showYearTotals && (
                        <td key={`total-${sku.id}-${year}`} className="px-1 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap border-l border-border bg-muted/30">
                          {formatNumber(getYearTotal(sku.id, year))}
                        </td>
                      )}
                    </>
                  ))}
                </tr>
              ))}

              {/* Total row */}
              <tr className="border-t-2 border-foreground/20 bg-muted/40 font-semibold">
                {showExcludeCheckbox && <td className="sticky left-0 bg-muted/40 z-10 px-1 py-2"></td>}
                {showWeight && <td className="sticky left-0 bg-muted/40 z-10 px-2 py-2"></td>}
                <td className={`${showWeight ? '' : 'sticky left-0 z-10 bg-muted/40'} px-2 py-2`}>
                  {excludedSkuIds.size > 0 ? `Total (excl. ${excludedSkuIds.size})` : 'Total'}
                </td>
                {periodsByYear.map(({ year, periods: yPeriods }) => (
                  <>
                    {yPeriods.map(p => (
                      <td key={`total-${p.id}`} className="px-1 py-2 text-right tabular-nums whitespace-nowrap">
                        {formatNumber(getColumnTotal(p.id))}
                      </td>
                    ))}
                    {showYearTotals && (
                      <td key={`grand-total-${year}`} className="px-1 py-2 text-right tabular-nums whitespace-nowrap border-l border-border bg-muted/50">
                        {formatNumber(getYearColumnTotal(year))}
                      </td>
                    )}
                  </>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
