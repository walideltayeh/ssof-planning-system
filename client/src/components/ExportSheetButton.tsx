import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExportSheetButtonProps {
  sheet: string;
  country?: string | null;
  label?: string;
}

export default function ExportSheetButton({ sheet, country, label }: ExportSheetButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ sheet });
      if (country && country !== "Lebanon") params.set("country", country);
      const response = await fetch(`/api/export-sheet?${params}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = response.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename=(.+)/);
      a.download = filenameMatch ? filenameMatch[1] : `SSOF_${sheet}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${label || sheet} exported successfully`);
    } catch (err: any) {
      toast.error("Export failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={isExporting}>
      {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label || "Export to Excel"}
    </Button>
  );
}
