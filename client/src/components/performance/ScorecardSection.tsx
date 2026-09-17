import type { CompareMode, PerformanceCountry, PeriodPreset, SectionProps } from "./types";
import { EmptyState, QuestionCard, RagBadge, usePerfFormat } from "./shared";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ScorecardSectionProps extends SectionProps {
  preset?: PeriodPreset;
  compare?: CompareMode;
  onOpenCountry?: (country: PerformanceCountry) => void;
}

export default function ScorecardSection({ pack, presentation, preset = pack.meta.preset, compare = pack.meta.compare, onOpenCountry }: ScorecardSectionProps) {
  const { fmtMc, fmtPct, fmtWeeks, unitLabel } = usePerfFormat();
  const scorecard = trpc.country.performanceScorecard.useQuery({
    preset: preset === "custom" ? "ytd" : preset,
    compare,
  });
  const rows = presentation ? scorecard.data?.slice(0, 8) : scorecard.data;

  return (
    <QuestionCard question="How do our countries compare this period?">
      {scorecard.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : scorecard.error ? (
        <EmptyState message={scorecard.error.message} />
      ) : !rows?.length ? (
        <EmptyState message="No country scorecard is available for this period" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead><TableHead>Period</TableHead><TableHead>Sell-out ({unitLabel})</TableHead>
                <TableHead>vs plan</TableHead><TableHead>vs last year</TableHead><TableHead>Production ({unitLabel})</TableHead>
                <TableHead>Plan attainment</TableHead><TableHead>Closing stock ({unitLabel})</TableHead><TableHead>Weeks of cover</TableHead>
                <TableHead>Forecast accuracy</TableHead><TableHead>SKUs at stock-out risk</TableHead><TableHead>Overstocked SKUs</TableHead>
                <TableHead>Pending clearance ({unitLabel})</TableHead><TableHead>Expiry risk ({unitLabel})</TableHead><TableHead>Confidence score</TableHead><TableHead>Overall status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.country} className={cn(row.country === pack.meta.country && "bg-[#7f1d1d]/5")}>
                  <TableCell>
                    <button type="button" className="font-semibold text-[#7f1d1d] hover:underline" onClick={() => onOpenCountry?.(row.country)}>
                      {row.country}
                    </button>
                  </TableCell>
                  <TableCell>{row.windowLabel}</TableCell><TableCell>{fmtMc(row.imsMc)}</TableCell>
                  <TableCell>{fmtPct(row.imsVsPlanPct)}</TableCell><TableCell>{fmtPct(row.imsVsLyPct)}</TableCell>
                  <TableCell>{fmtMc(row.productionMc)}</TableCell><TableCell>{fmtPct(row.planAttainmentPct)}</TableCell>
                  <TableCell>{fmtMc(row.closingStockMc)}</TableCell><TableCell>{fmtWeeks(row.weeksOfCover)}</TableCell>
                  <TableCell>{fmtPct(row.forecastAccuracyPct)}</TableCell><TableCell>{row.stockoutRiskSkus}</TableCell>
                  <TableCell>{row.overstockSkus}</TableCell><TableCell>{fmtMc(row.pendingClearanceMc)}</TableCell>
                  <TableCell>{fmtMc(row.expiryRiskMc)}</TableCell><TableCell>{row.confidenceScore}</TableCell>
                  <TableCell><RagBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {presentation && (scorecard.data?.length ?? 0) > 8 && <p className="mt-2 text-xs text-muted-foreground">+{scorecard.data!.length - 8} more in the full pack</p>}
        </>
      )}
    </QuestionCard>
  );
}
