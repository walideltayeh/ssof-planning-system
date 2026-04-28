import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface ImportSheetButtonProps {
  sheet: string;
  country?: string | null;
  label?: string;
  onSuccess?: () => void;
}

export default function ImportSheetButton({ sheet, country, label, onSuccess }: ImportSheetButtonProps) {
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".xlsx")) {
      toast.error("Please upload an .xlsx file");
      e.target.value = "";
      return;
    }

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const params = new URLSearchParams({ sheet });
      if (country && country !== "Lebanon") params.set("country", country);

      const response = await fetch(`/api/import-sheet?${params}`, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      const skippedMsg = result.skipped?.length > 0
        ? ` (${result.skipped.length} unrecognized SKUs skipped)`
        : "";

      const periodInfo = result.matchedPeriods?.length > 0
        ? ` — Periods: ${result.matchedPeriods.join(", ")}`
        : "";

      toast.success(`Imported ${result.updated} records into ${result.sheet}${skippedMsg}${periodInfo}`, { duration: 6000 });

      if (result.unmatchedPeriods?.length > 0) {
        toast.warning(`Unrecognized periods in file: ${result.unmatchedPeriods.join(", ")}`, { duration: 8000 });
      }

      if (result.skipped?.length > 0) {
        toast.warning(`Skipped SKUs: ${result.skipped.join(", ")}`, { duration: 8000 });
      }

      utils.invalidate();
      onSuccess?.();
    } catch (err: any) {
      toast.error("Import failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button variant="outline" size="sm" className="gap-2" onClick={handleClick} disabled={isImporting}>
        {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {label || "Import from Excel"}
      </Button>
    </>
  );
}
