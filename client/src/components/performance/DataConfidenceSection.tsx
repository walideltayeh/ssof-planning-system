import { useState } from "react";
import type { SectionProps } from "./types";
import { EmptyState, QuestionCard, RagDot, usePerfFormat } from "./shared";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function DataConfidenceSection({ pack, presentation }: SectionProps) {
  const [missingOpen, setMissingOpen] = useState(false);
  const { fmtMc, fmtMcSigned, unitLabel } = usePerfFormat();
  const confidence = pack.confidence;
  const mismatches = presentation ? confidence.reconciliation.mismatches.slice(0, 8) : confidence.reconciliation.mismatches;

  return (
    <div className="space-y-4">
      <QuestionCard question="How much can we trust these numbers?">
        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          <div>
            <div className={presentation ? "text-3xl font-bold" : "text-2xl font-bold"}>{confidence.score} / 100</div>
            <p className="mb-3 text-sm font-medium">{confidence.grade} confidence</p>
            <Progress value={confidence.score} className="h-3 [&_[data-slot=progress-indicator]]:bg-[#7f1d1d]" />
          </div>
          {confidence.issues.length ? (
            <ul className="space-y-3">
              {confidence.issues.map((issue) => (
                <li key={`${issue.title}-${issue.count}`} className="flex items-start gap-2">
                  <RagDot status={issue.severity} className="mt-1" />
                  <div><p className="font-medium">{issue.title} <span className="text-muted-foreground">({issue.count})</span></p><p className="text-sm text-muted-foreground">{issue.detail}</p></div>
                </li>
              ))}
            </ul>
          ) : <EmptyState message="No data confidence issues were found" />}
        </div>
      </QuestionCard>

      <QuestionCard question="Does closing stock match Planning FG?">
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-2"><RagDot status={confidence.reconciliation.ok ? "green" : "red"} />{confidence.reconciliation.ok ? "Matched" : "Mismatch found"}</span>
          <span>Month checked: {confidence.reconciliation.month ?? "–"}</span>
          <span>SKUs checked: {confidence.reconciliation.checkedSkus}</span>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{confidence.reconciliation.note}</p>
        {mismatches.length > 0 && (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Pack closing ({unitLabel})</TableHead><TableHead>Planning FG closing ({unitLabel})</TableHead><TableHead>Difference ({unitLabel})</TableHead></TableRow></TableHeader>
              <TableBody>{mismatches.map((row) => <TableRow key={`${row.sku}-${row.weight}`}><TableCell className="font-medium">{row.sku}<span className="block text-xs text-muted-foreground">{row.weight}</span></TableCell><TableCell>{fmtMc(row.packClosing)}</TableCell><TableCell>{fmtMc(row.planningFgClosing)}</TableCell><TableCell>{fmtMcSigned(row.difference)}</TableCell></TableRow>)}</TableBody>
            </Table>
            {presentation && confidence.reconciliation.mismatches.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{confidence.reconciliation.mismatches.length - 8} more in the full pack</p>}
          </>
        )}
      </QuestionCard>

      <div className="grid gap-4 md:grid-cols-2">
        <QuestionCard question="How fresh are the source sheets?">
          <Table><TableHeader><TableRow><TableHead>Sheet</TableHead><TableHead>Last updated</TableHead></TableRow></TableHeader>
            <TableBody>{confidence.freshness.map((row) => <TableRow key={row.sheet}><TableCell>{row.sheet}</TableCell><TableCell>{row.lastUpdated ?? "never"}</TableCell></TableRow>)}</TableBody>
          </Table>
        </QuestionCard>
        <QuestionCard question="Where are important inputs missing?">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>Auto-filled sell-out (IMS) months</dt><dd className="font-semibold">{confidence.autoFilledImsMonths}</dd>
            <dt>SKUs without forecast</dt><dd className="font-semibold">{confidence.skusWithoutForecast.length}</dd>
            <dt>SKUs missing price list</dt><dd className="font-semibold">{confidence.skusMissingPrice.length}</dd>
          </dl>
          {confidence.skusWithoutForecast.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Without forecast: {confidence.skusWithoutForecast.map((row) => `${row.sku} (${row.weight})`).join(", ")}</p>}
          {confidence.skusMissingPrice.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Missing price list: {confidence.skusMissingPrice.join(", ")}</p>}
        </QuestionCard>
      </div>

      <QuestionCard question="Which SKUs have missing sell-out (IMS) months?">
        {confidence.missingImsMonths.length === 0 ? <EmptyState message="No sell-out (IMS) months are missing" /> : (
          <Collapsible open={missingOpen} onOpenChange={setMissingOpen}>
            <CollapsibleTrigger asChild><Button variant="outline" size="sm">Show {confidence.missingImsMonths.length} affected SKUs <ChevronDown className="ml-2 h-4 w-4" /></Button></CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Weight</TableHead><TableHead>Missing months</TableHead></TableRow></TableHeader>
                <TableBody>{confidence.missingImsMonths.slice(0, presentation ? 8 : undefined).map((row) => <TableRow key={`${row.sku}-${row.weight}`}><TableCell>{row.sku}</TableCell><TableCell>{row.weight}</TableCell><TableCell>{row.months.join(", ")}</TableCell></TableRow>)}</TableBody>
              </Table>
              {presentation && confidence.missingImsMonths.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{confidence.missingImsMonths.length - 8} more in the full pack</p>}
            </CollapsibleContent>
          </Collapsible>
        )}
      </QuestionCard>
    </div>
  );
}
