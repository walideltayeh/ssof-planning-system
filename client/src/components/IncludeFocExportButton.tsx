import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUnit } from "@/contexts/UnitContext";

/** Planning-FG export keeps the same FOC inclusion basis as its live ledger. */
export default function IncludeFocExportButton({
  sheet, country, includeFoc, label,
}: {
  sheet: string;
  country: string;
  includeFoc: boolean;
  label: string;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const { unit } = useUnit();
  const exportSheet = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ sheet, country, includeFoc: String(includeFoc), unit });
      const response = await fetch(`/api/export-sheet?${params.toString()}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(error.error || "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const disposition = response.headers.get("Content-Disposition");
      anchor.download = disposition?.match(/filename=(.+)/)?.[1] ?? `SSOF_${sheet}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${label} exported with ${includeFoc ? "FOC included" : "FOC excluded"}`);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={exportSheet} disabled={isExporting}>
      {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {isExporting ? "Preparing…" : label}
    </Button>
  );
}
