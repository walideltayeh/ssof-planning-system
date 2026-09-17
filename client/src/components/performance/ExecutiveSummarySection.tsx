import type { KpiTile, SectionProps } from "./types";
import { DeltaChip, EmptyState, QuestionCard, RagBadge, RagDot, Sparkline, usePerfFormat } from "./shared";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const LOWER_IS_BETTER = new Set(["stockoutRisk", "overstock", "pendingClearance", "expiryRisk"]);

export default function ExecutiveSummarySection({ pack, presentation }: SectionProps) {
  const { fmtMc, fmtValue, unitFor, unitLabel } = usePerfFormat();
  const comparison = pack.meta.compare;
  const comparisonOrder: Array<{ key: "vsPlan" | "vsLastYear" | "vsPrevious"; label: string }> = [
    comparison === "plan"
      ? { key: "vsPlan", label: "vs plan" }
      : comparison === "ly"
        ? { key: "vsLastYear", label: "vs last year" }
        : { key: "vsPrevious", label: "vs previous period" },
    ...([
      { key: "vsPlan" as const, label: "vs plan" },
      { key: "vsLastYear" as const, label: "vs last year" },
      { key: "vsPrevious" as const, label: "vs previous period" },
    ].filter((item) => item.key !== (comparison === "plan" ? "vsPlan" : comparison === "ly" ? "vsLastYear" : "vsPrevious"))),
  ];
  const risks = presentation ? pack.executive.risks.slice(0, 8) : pack.executive.risks;

  return (
    <div className="space-y-4">
      <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", presentation && "xl:grid-cols-5")}>
        {pack.executive.tiles.map((tile: KpiTile) => (
          <QuestionCard key={tile.key} question={tile.label} hint={tile.question} className="h-full">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className={cn("font-bold tracking-tight", presentation ? "text-3xl" : "text-2xl")}>
                    {fmtValue(tile.value, tile.unit)}
                  </div>
                  <div className="text-xs text-muted-foreground">{unitFor(tile.unit)}</div>
                </div>
                <span title={tile.statusReason}><RagBadge status={tile.status} /></span>
              </div>
              {tile.subValue && <p className="text-sm text-muted-foreground">{tile.subValue}</p>}
              <div className="flex flex-col gap-1">
                {comparisonOrder.map((item, index) => (
                  <div key={item.key} className={index === 0 ? "" : "opacity-70"}>
                    <DeltaChip
                      delta={tile[item.key]}
                      label={item.label}
                      unit={tile.unit}
                      invert={LOWER_IS_BETTER.has(tile.key)}
                    />
                  </div>
                ))}
              </div>
              <Sparkline points={tile.sparkline} className="mt-2 w-full" width={150} height={32} />
              {tile.note && <p className="text-xs text-muted-foreground">{tile.note}</p>}
            </div>
          </QuestionCard>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <QuestionCard question="What are the key messages?">
          {pack.executive.keyMessages.length === 0 ? (
            <EmptyState message="Nothing needs escalation this period" />
          ) : (
            <ol className="space-y-3">
              {pack.executive.keyMessages.map((message) => (
                <li
                  key={`${message.rank}-${message.headline}`}
                  className={cn(
                    "border-l-4 pl-3",
                    message.tone === "positive" && "border-green-600",
                    message.tone === "warning" && "border-amber-500",
                    message.tone === "negative" && "border-red-700",
                    message.tone === "neutral" && "border-gray-400",
                  )}
                >
                  <div className="flex gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{message.rank}</span>
                    <div>
                      <p className="font-semibold">{message.headline}</p>
                      <p className={cn("text-sm text-muted-foreground", presentation && "text-base")}>{message.detail}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </QuestionCard>

        <QuestionCard question="What are the top risks and decisions?">
          {risks.length === 0 ? (
            <EmptyState message="Nothing needs escalation this period" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead><TableHead>SKU</TableHead><TableHead>Issue</TableHead>
                    <TableHead>Impact ({unitLabel})</TableHead><TableHead>Recommended action</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {risks.map((risk) => (
                    <TableRow key={`${risk.rank}-${risk.sku}`}>
                      <TableCell>{risk.rank}</TableCell>
                      <TableCell className="font-medium">{risk.sku}<span className="block text-xs text-muted-foreground">{risk.weight}</span></TableCell>
                      <TableCell className="max-w-48 whitespace-normal">{risk.issue}</TableCell>
                      <TableCell>{fmtMc(risk.impactMc)}</TableCell>
                      <TableCell className="max-w-56 whitespace-normal">{risk.action}</TableCell>
                      <TableCell><RagDot status={risk.severity} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {presentation && pack.executive.risks.length > 8 && (
                <p className="mt-2 text-xs text-muted-foreground">+{pack.executive.risks.length - 8} more in the full pack</p>
              )}
            </>
          )}
        </QuestionCard>
      </div>
    </div>
  );
}
