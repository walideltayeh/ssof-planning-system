import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ExcelSample {
  sheet: string;
  skuName: string;
  period: string;
  value: number;
}

interface ValidationSummaryProps {
  excelSamples: ExcelSample[];
  onClose: () => void;
}

export function ValidationSummary({ excelSamples, onClose }: ValidationSummaryProps) {
  const { data: forecastData } = trpc.data.forecast.useQuery();
  const { data: imsData } = trpc.data.ims.useQuery();

  const results = useMemo(() => {
    if (!forecastData || !imsData) return null;

    const comparisons: {
      sheet: string;
      skuName: string;
      period: string;
      excelValue: number;
      dbValue: number | null;
      match: boolean;
    }[] = [];

    for (const sample of excelSamples) {
      let dbValue: number | null = null;

      // Parse period string "Jan 2025" -> { month: 1, year: 2025 }
      const parts = sample.period.split(" ");
      const monthNames: Record<string, number> = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
      };
      const month = monthNames[parts[0]] || 0;
      const year = parseInt(parts[1]) || 0;

      if (sample.sheet === "Forecast" && forecastData) {
        const sku = forecastData.skus.find(s => s.name.includes(sample.skuName) || sample.skuName.includes(s.name));
        const period = forecastData.periods.find(p => p.month === month && p.year === year);
        if (sku && period) {
          const row = forecastData.data.find((d: any) => d.skuId === sku.id && d.periodId === period.id);
          dbValue = row ? parseFloat(String(row.value ?? "0")) || 0 : 0;
        }
      } else if (sample.sheet === "IMS" && imsData) {
        const sku = imsData.skus.find(s => s.name.includes(sample.skuName) || sample.skuName.includes(s.name));
        const period = imsData.periods.find(p => p.month === month && p.year === year);
        if (sku && period) {
          const row = imsData.data.find((d: any) => d.skuId === sku.id && d.periodId === period.id);
          dbValue = row ? parseFloat(String(row.value ?? "0")) || 0 : 0;
        }
      }

      comparisons.push({
        sheet: sample.sheet,
        skuName: sample.skuName,
        period: sample.period,
        excelValue: sample.value,
        dbValue,
        match: dbValue !== null && Math.abs(dbValue - sample.value) < 0.01,
      });
    }

    return comparisons;
  }, [excelSamples, forecastData, imsData]);

  if (!results) {
    return (
      <Card className="border-2 border-blue-200">
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Loading validation data...
        </CardContent>
      </Card>
    );
  }

  const totalChecks = results.length;
  const matches = results.filter(r => r.match).length;
  const mismatches = results.filter(r => !r.match);
  const allMatch = mismatches.length === 0;

  // Group by sheet
  const sheets = Array.from(new Set(results.map(r => r.sheet)));

  return (
    <Card className={`border-2 ${allMatch ? "border-green-200" : "border-amber-200"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {allMatch ? (
              <span className="text-green-600">Data Validation: All {totalChecks} checks passed</span>
            ) : (
              <span className="text-amber-600">Data Validation: {matches}/{totalChecks} checks passed ({mismatches.length} mismatches)</span>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-7">
            Dismiss
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sheets.map(sheet => {
          const sheetResults = results.filter(r => r.sheet === sheet);
          const skus = Array.from(new Set(sheetResults.map(r => r.skuName)));

          return (
            <div key={sheet}>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">{sheet} Sheet — First {skus.length} SKUs</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-2 py-1 text-left font-medium">SKU</th>
                      {Array.from(new Set(sheetResults.map(r => r.period))).map(period => (
                        <th key={period} className="px-2 py-1 text-center font-medium">{period}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {skus.map(sku => {
                      const skuResults = sheetResults.filter(r => r.skuName === sku);
                      return (
                        <>
                          <tr key={`${sku}-excel`} className="border-t">
                            <td className="px-2 py-0.5 font-medium whitespace-nowrap" rowSpan={2}>{sku}</td>
                            {skuResults.map((r, i) => (
                              <td key={i} className="px-2 py-0.5 text-center text-blue-600 font-mono">
                                {r.excelValue}
                                <span className="text-[8px] text-muted-foreground ml-0.5">xlsx</span>
                              </td>
                            ))}
                          </tr>
                          <tr key={`${sku}-db`}>
                            {skuResults.map((r, i) => (
                              <td key={i} className={`px-2 py-0.5 text-center font-mono ${
                                r.match ? "text-green-600" : "text-red-600 bg-red-50 font-bold"
                              }`}>
                                {r.dbValue !== null ? r.dbValue : "N/A"}
                                <span className="text-[8px] text-muted-foreground ml-0.5">db</span>
                                {r.match && <span className="ml-0.5 text-green-500">✓</span>}
                                {!r.match && <span className="ml-0.5 text-red-500">✗</span>}
                              </td>
                            ))}
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {!allMatch && (
          <p className="text-[10px] text-amber-600">
            Mismatches may indicate a parsing issue. Check the SKU name matching and column alignment in the Excel file.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
