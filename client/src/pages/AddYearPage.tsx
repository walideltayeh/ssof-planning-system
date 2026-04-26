import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function AddYearPage() {
  const { user: appUser } = useAppAuth();
  const { data: existingYears, isLoading: yearsLoading } = trpc.periods.existingYears.useQuery({ country: "Lebanon" });
  const utils = trpc.useUtils();

  const addYear = trpc.periods.addYear.useMutation({
    onSuccess: (result: any) => {
      utils.periods.list.invalidate();
      utils.periods.existingYears.invalidate();
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.shipment.invalidate();
      utils.data.arrival.invalidate();
      utils.data.planningFg.invalidate();
      toast.success(`Year ${selectedYear} added successfully with ${result.periodsCreated} periods and ${result.dataRowsCreated} data rows`);
    },
    onError: (err: any) => toast.error("Failed to add year: " + err.message),
  });

  const currentYear = new Date().getFullYear();
  const allYears = Array.from({ length: 10 }, (_, i) => currentYear - 2 + i);
  const availableYears = allYears.filter(y => !(existingYears ?? []).includes(y));
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const handleAddYear = () => {
    if (!selectedYear) {
      toast.error("Please select a year");
      return;
    }
    addYear.mutate({ year: selectedYear});
  };

  if (yearsLoading) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add Year</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add a new year to the planning system. This creates 12 monthly periods and initializes empty data rows for all existing SKUs across every table.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Current Years</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {(existingYears ?? []).sort().map(year => (
              <span key={year} className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-semibold text-sm">
                {year}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {(existingYears ?? []).length * 12} monthly periods currently tracked.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Add New Year</CardTitle>
        </CardHeader>
        <CardContent>
          {availableYears.length === 0 ? (
            <p className="text-sm text-muted-foreground">All available years have already been added.</p>
          ) : (
            <div className="flex gap-3 items-end">
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">Select Year</label>
                <Select value={selectedYear?.toString() ?? ""} onValueChange={v => setSelectedYear(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map(y => (
                      <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddYear} disabled={addYear.isPending || !selectedYear}>
                {addYear.isPending ? "Adding..." : "Add Year"}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Adding a year will create 12 monthly periods (Jan-Dec) and initialize empty data rows for all existing SKUs in Forecast, IMS, Shipment, Arrival, and Planning FG tables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
