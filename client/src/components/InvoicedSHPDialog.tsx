import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Truck, Package, ArrowRight, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

interface WeekData {
  week1: number;
  week2: number;
  week3: number;
  week4: number;
}

interface InvoicedSHPDialogProps {
  open: boolean;
  onClose: () => void;
  skuId: number;
  periodId: number;
  skuName: string;
  periodLabel: string;
  /** Label of the next period (e.g. "May 26") for arrival preview */
  nextPeriodLabel?: string;
  /** Existing shipment weekly values */
  existingWeeks?: Partial<WeekData>;
  onSaved?: (invoicedTotal: number) => void;
}

/** +2 week offset rule:
 *  W1 ships → arrives W3 (same month)
 *  W2 ships → arrives W4 (same month)
 *  W3 ships → arrives W1 (next month)
 *  W4 ships → arrives W2 (next month)
 */
function computeArrivalPreview(weeks: WeekData, periodLabel: string, nextPeriodLabel?: string) {
  const rows: { ship: string; arrives: string; period: string; value: number }[] = [];
  if (weeks.week1 > 0) rows.push({ ship: "W1", arrives: "W3", period: periodLabel, value: weeks.week1 });
  if (weeks.week2 > 0) rows.push({ ship: "W2", arrives: "W4", period: periodLabel, value: weeks.week2 });
  if (weeks.week3 > 0) rows.push({ ship: "W3", arrives: "W1", period: nextPeriodLabel || "next month", value: weeks.week3 });
  if (weeks.week4 > 0) rows.push({ ship: "W4", arrives: "W2", period: nextPeriodLabel || "next month", value: weeks.week4 });
  return rows;
}

export function InvoicedSHPDialog({
  open, onClose, skuId, periodId, skuName, periodLabel, nextPeriodLabel, existingWeeks, onSaved,
}: InvoicedSHPDialogProps) {
  const { user } = useAuth();
  const [weeks, setWeeks] = useState<WeekData>({ week1: 0, week2: 0, week3: 0, week4: 0 });

  // Populate with existing values when dialog opens
  useEffect(() => {
    if (open) {
      setWeeks({
        week1: existingWeeks?.week1 ?? 0,
        week2: existingWeeks?.week2 ?? 0,
        week3: existingWeeks?.week3 ?? 0,
        week4: existingWeeks?.week4 ?? 0,
      });
    }
  }, [open, existingWeeks]);

  const utils = trpc.useUtils();
  const invoicedMutation = trpc.update.invoicedSHP.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Invoiced (SHP) saved — Total: ${data.invoicedTotal} units. Arrivals auto-scheduled +2 weeks.`,
        { duration: 4000 }
      );
      utils.data.planningFg.invalidate();
      utils.data.arrival.invalidate();
      utils.data.forecast.invalidate();
      utils.data.imsVsForecast.invalidate();
      onSaved?.(data.invoicedTotal);
      onClose();
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const total = weeks.week1 + weeks.week2 + weeks.week3 + weeks.week4;
  const arrivalPreview = computeArrivalPreview(weeks, periodLabel, nextPeriodLabel);

  const handleWeekChange = (week: keyof WeekData, value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    setWeeks(prev => ({ ...prev, [week]: num }));
  };

  const handleSave = () => {
    invoicedMutation.mutate({
      skuId, periodId,
      week1: weeks.week1, week2: weeks.week2, week3: weeks.week3, week4: weeks.week4,
      username: user?.name || "User",
      skuName, periodLabel,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-orange-500" />
            Invoiced (SHP) — {periodLabel}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{skuName}</p>
        </DialogHeader>

        {/* Week inputs */}
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            {(["week1", "week2", "week3", "week4"] as const).map((wk, i) => {
              const weekNum = i + 1;
              const arrivesWeek = weekNum <= 2 ? weekNum + 2 : weekNum - 2;
              const arrivesPeriod = weekNum <= 2 ? periodLabel : (nextPeriodLabel || "next month");
              return (
                <div key={wk} className="space-y-1">
                  <Label className="text-sm font-medium">
                    W{weekNum}
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      → arrives W{arrivesWeek} {arrivesPeriod}
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={weeks[wk] || ""}
                    placeholder="0"
                    onChange={(e) => handleWeekChange(wk, e.target.value)}
                    className="h-9"
                  />
                </div>
              );
            })}
          </div>

          {/* Monthly total */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 border">
            <span className="text-sm font-medium text-muted-foreground">Monthly Total (Invoiced)</span>
            <span className="text-lg font-bold">{total.toLocaleString()}</span>
          </div>

          {/* Arrival preview */}
          {arrivalPreview.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <Package className="h-3.5 w-3.5" />
                Arrival Schedule Preview
              </div>
              <div className="rounded-lg border divide-y">
                {arrivalPreview.map((row, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 text-xs">
                        Ships {row.ship}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-xs">
                        Arrives {row.arrives} · {row.period}
                      </Badge>
                    </div>
                    <span className="font-medium">{row.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Saving will update the <strong>Invoiced (SHP)</strong> monthly total and automatically
              create <strong>Actual Arrivals</strong> entries 2 weeks later in the Planning FG table.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={invoicedMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={invoicedMutation.isPending || total === 0}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {invoicedMutation.isPending ? "Saving…" : `Save & Schedule Arrivals`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
