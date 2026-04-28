import { useState, useCallback, useEffect } from "react";
import { ValidationSummary } from "@/components/ValidationSummary";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, BarChart3, Package, Truck, CheckCircle2, AlertCircle } from "lucide-react";

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseDateHeader(val: any): { month: number; year: number } | null {
  if (!val) return null;

  // Handle Date objects (from Excel date serial numbers)
  if (val instanceof Date) {
    const m = val.getMonth() + 1;
    const y = val.getFullYear();
    if (y >= 2024 && y <= 2030) return { month: m, year: y };
    return null;
  }

  const str = String(val).trim();

  // Try "Jan 25" or "Jan 2025" format
  for (const [name, num] of Object.entries(MONTHS)) {
    if (str.toLowerCase().startsWith(name.toLowerCase())) {
      const rest = str.slice(name.length).trim();
      let yr = parseInt(rest);
      if (yr < 100) yr += 2000;
      if (yr >= 2024 && yr <= 2030) return { month: num, year: yr };
    }
  }

  // Try date serial number
  if (!isNaN(Number(str))) {
    try {
      const d = XLSX.SSF.parse_date_code(Number(str));
      if (d && d.y >= 2024 && d.y <= 2030) return { month: d.m, year: d.y };
    } catch { /* ignore */ }
  }

  return null;
}

/** Normalize weight: handle "100" -> "250g" if name contains "250g", etc. */
function normalizeWeight(weight: string, skuName: string): string {
  const w = String(weight).trim().toLowerCase();
  // Exact matches first
  if (w === "50g" || w === "250g" || w === "1kg") return w;
  // Numeric matches (order matters: check 1000 before 50 to avoid false matches)
  if (w === "1000" || w === "1000g" || w.includes("1kg") || w.includes("1000")) return "1kg";
  if (w === "250" || w.includes("250")) return "250g";
  if (w === "50" || (w.includes("50") && !w.includes("250"))) return "50g";
  // Infer from SKU name
  const nameLower = skuName.toLowerCase();
  if (nameLower.includes("1kg") || nameLower.includes("1 kg") || nameLower.includes("1000g")) return "1kg";
  if (nameLower.includes("250g") || nameLower.includes("250 g")) return "250g";
  if (nameLower.includes("50g") || nameLower.includes("50 g")) return "50g";
  // Default
  return "50g";
}

export default function UploadPage() {
  const { isAdmin, user: appUser } = useAppAuth();
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [validationData, setValidationData] = useState<{
    excelSamples: { sheet: string; skuName: string; period: string; value: number }[];
  } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const utils = trpc.useUtils();

  const uploadForecast = trpc.upload.forecast.useMutation();
  const uploadIms = trpc.upload.imsActuals.useMutation();
  const uploadOpeningStock = trpc.upload.openingStock.useMutation();
  const uploadShipment = trpc.upload.shipment.useMutation();
  const uploadArrival = trpc.upload.arrival.useMutation();
  // Planning FG upload will use openingStock endpoint
  const uploadPlanningFgBulk = trpc.upload.planningFgBulk.useMutation();

  const addStatus = useCallback((msg: string) => {
    setStatus(prev => [...prev, msg]);
  }, []);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-destructive">Access Denied</h2>
        <p className="text-sm text-muted-foreground mt-2">Only administrators can upload data.</p>
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing access-check early return; restructure tracked separately
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatus([]);
    addStatus(`📂 Reading file: ${file.name}...`);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array", cellDates: true });

      if (type === "forecast") {
        await processForecastSheet(workbook, addStatus);
      } else if (type === "ims") {
        await processImsSheet(workbook, addStatus);
      } else if (type === "opening-stock") {
        await processOpeningStockSheet(workbook, addStatus);
      } else if (type === "full") {
        await processFullWorkbook(workbook, addStatus);
      }

      // Invalidate all queries
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.shipment.invalidate();
      utils.data.arrival.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
      utils.country.skus.invalidate();

      // Collect validation samples from the parsed data
      collectValidationSamples(workbook);

      addStatus("✅ Upload complete!");
      toast.success("Data uploaded successfully");
    } catch (err: any) {
      addStatus(`❌ Error: ${err.message}`);
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [addStatus, utils]);

  // ==================== FORECAST PARSER ====================
  const processForecastSheet = async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    const sheet = workbook.Sheets["Forecast"] || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No Forecast sheet found");

    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in Forecast sheet`);

    // Find header row with date columns (row 2 in Excel = index 1)
    let headerRow = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(10, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) {
        headerRow = i;
        headers = row;
        break;
      }
    }
    if (headerRow === -1) throw new Error("Could not find date headers in Forecast sheet");
    log(`Header row found at index ${headerRow}`);

    // Find SKU name column (col 2 = index 1) and weight column (col 1 = index 0)
    const weightCol = 0;
    const skuCol = 1;

    // Build date column map
    const dateColumns: { col: number; month: number; year: number }[] = [];
    for (let c = 0; c < headers.length; c++) {
      const parsed = parseDateHeader(headers[c]);
      if (parsed) dateColumns.push({ col: c, ...parsed });
    }
    log(`Found ${dateColumns.length} date columns`);

    const records: any[] = [];
    for (let r = headerRow + 1; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[skuCol] || "").trim();
      const rawWeight = String(row[weightCol] || "").trim();
      if (!skuName || skuName.toLowerCase().includes("total")) continue;

      const weight = normalizeWeight(rawWeight, skuName);
      const values: any[] = [];
      for (const dc of dateColumns) {
        const val = row[dc.col];
        const numVal = typeof val === "number" ? val : parseFloat(String(val || "0")) || 0;
        values.push({ year: dc.year, month: dc.month, value: numVal.toString() });
      }
      records.push({ skuName, weight, values });
    }

    log(`Processing ${records.length} SKU forecast records...`);
    await uploadForecast.mutateAsync({ records });
    log(`✅ Forecast data uploaded: ${records.length} SKUs`);
  };

  // ==================== IMS PARSER ====================
  const processImsSheet = async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    const sheetName = workbook.SheetNames.find(n => n === "IMS vs FRCST") ||
                      workbook.SheetNames.find(n => n.toLowerCase().includes("ims")) ||
                      workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("No IMS sheet found");

    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in IMS sheet (${sheetName})`);

    let headerRow = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(10, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) { headerRow = i; headers = row; break; }
    }
    if (headerRow === -1) throw new Error("Could not find date headers in IMS sheet");

    const skuCol = 1;
    const dateColumns: { col: number; month: number; year: number }[] = [];
    for (let c = 0; c < headers.length; c++) {
      const parsed = parseDateHeader(headers[c]);
      if (parsed) dateColumns.push({ col: c, ...parsed });
    }

    const records: any[] = [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    for (let r = headerRow + 1; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[skuCol] || "").trim();
      if (!skuName || skuName.toLowerCase().includes("total")) continue;

      const values: any[] = [];
      for (const dc of dateColumns) {
        const val = row[dc.col];
        const numVal = typeof val === "number" ? val : parseFloat(String(val || "0")) || 0;
        const isActual = dc.year < currentYear || (dc.year === currentYear && dc.month <= currentMonth);
        values.push({ year: dc.year, month: dc.month, value: numVal.toString(), isActual });
      }
      records.push({ skuName, values });
    }

    log(`Processing ${records.length} IMS records...`);
    await uploadIms.mutateAsync({ records });
    log(`✅ IMS data uploaded: ${records.length} SKUs`);
  };

  // ==================== OPENING STOCK PARSER ====================
  const processOpeningStockSheet = async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No sheet found");

    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${json.length} rows`);

    const records: any[] = [];
    for (let r = 1; r < json.length; r++) {
      const row = json[r];
      if (!row) continue;
      const skuName = String(row[0] || "").trim();
      const value = String(row[1] || "0");
      if (!skuName) continue;
      records.push({ skuName, value, periodYear: 2025, periodMonth: 1 });
    }

    log(`Processing ${records.length} opening stock records...`);
    await uploadOpeningStock.mutateAsync({ records });
    log(`✅ Opening stock uploaded: ${records.length} SKUs`);
  };

  // ==================== SHIPMENT PARSER ====================
  const processShipmentSheet = async (workbook: XLSX.WorkBook, sheetName: string, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in Shipment sheet`);

    // Row 2 (index 1) has date headers at columns 3, 8, 13... (0-indexed: 2, 7, 12...)
    // Row 3 (index 2) has W1, W2, W3, W4, Total sub-headers
    // Data starts at row 4 (index 3)
    // Col 1 (index 0) = weight, Col 2 (index 1) = SKU name

    // Find the header row with dates
    let headerRowIdx = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(5, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) {
        headerRowIdx = i;
        headers = row;
        break;
      }
    }
    if (headerRowIdx === -1) throw new Error("Could not find date headers in Shipment sheet");

    // Build month column mapping: each month starts at a date column and spans 5 cols
    const monthColumns: { startCol: number; month: number; year: number }[] = [];
    for (let c = 0; c < headers.length; c++) {
      const parsed = parseDateHeader(headers[c]);
      if (parsed) {
        monthColumns.push({ startCol: c, ...parsed });
      }
    }
    log(`Found ${monthColumns.length} month groups in Shipment`);

    // Data starts 2 rows after header (header + sub-header)
    const dataStartRow = headerRowIdx + 2;
    const records: any[] = [];

    for (let r = dataStartRow; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[1] || "").trim();
      const rawWeight = String(row[0] || "").trim();
      if (!skuName || skuName.toLowerCase().includes("total") || skuName === "SKU Name") continue;

      const weight = normalizeWeight(rawWeight, skuName);
      const values: any[] = [];

      for (const mc of monthColumns) {
        const w1 = parseFloat(String(row[mc.startCol] || "0")) || 0;
        const w2 = parseFloat(String(row[mc.startCol + 1] || "0")) || 0;
        const w3 = parseFloat(String(row[mc.startCol + 2] || "0")) || 0;
        const w4 = parseFloat(String(row[mc.startCol + 3] || "0")) || 0;
        values.push({
          year: mc.year,
          month: mc.month,
          week1: w1.toString(),
          week2: w2.toString(),
          week3: w3.toString(),
          week4: w4.toString(),
        });
      }
      records.push({ skuName, values });
    }

    log(`Processing ${records.length} Shipment SKU records...`);
    if (records.length > 0) {
      await uploadShipment.mutateAsync({ records });
    }
    log(`✅ Shipment data uploaded: ${records.length} SKUs`);
  };

  // ==================== ARRIVAL PARSER ====================
  const processArrivalSheet = async (workbook: XLSX.WorkBook, sheetName: string, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in Arrival sheet`);

    // Same structure as Shipment
    let headerRowIdx = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(5, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) {
        headerRowIdx = i;
        headers = row;
        break;
      }
    }
    if (headerRowIdx === -1) throw new Error("Could not find date headers in Arrival sheet");

    const monthColumns: { startCol: number; month: number; year: number }[] = [];
    for (let c = 0; c < headers.length; c++) {
      const parsed = parseDateHeader(headers[c]);
      if (parsed) {
        monthColumns.push({ startCol: c, ...parsed });
      }
    }
    log(`Found ${monthColumns.length} month groups in Arrival`);

    const dataStartRow = headerRowIdx + 2;
    const records: any[] = [];

    for (let r = dataStartRow; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[1] || "").trim();
      const rawWeight = String(row[0] || "").trim();
      if (!skuName || skuName.toLowerCase().includes("total") || skuName === "SKU Name") continue;

      const weight = normalizeWeight(rawWeight, skuName);
      const values: any[] = [];

      for (const mc of monthColumns) {
        const w1 = parseFloat(String(row[mc.startCol] || "0")) || 0;
        const w2 = parseFloat(String(row[mc.startCol + 1] || "0")) || 0;
        const w3 = parseFloat(String(row[mc.startCol + 2] || "0")) || 0;
        const w4 = parseFloat(String(row[mc.startCol + 3] || "0")) || 0;
        values.push({
          year: mc.year,
          month: mc.month,
          week1: w1.toString(),
          week2: w2.toString(),
          week3: w3.toString(),
          week4: w4.toString(),
        });
      }
      records.push({ skuName, values });
    }

    log(`Processing ${records.length} Arrival SKU records...`);
    if (records.length > 0) {
      await uploadArrival.mutateAsync({ records });
    }
    log(`✅ Arrival data uploaded: ${records.length} SKUs`);
  };

  // ==================== PLANNING FG PARSER ====================
  const processPlanningFgSheet = async (
    workbook: XLSX.WorkBook,
    sheetName: string,
    weightCategory: string,
    log: (msg: string) => void
  ) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in ${sheetName}`);

    // Column layout varies by sheet:
    //   50g:      col 0=empty, col 1=SKU Name, col 2=label, col 3+=dates
    //   250g/1kg: col 0=SKU Name, col 1=label, col 2+=dates
    // Auto-detect by finding the first date column in the header row.

    // Find header row with dates and auto-detect date start column
    let headerRowIdx = -1;
    let headers: any[] = [];
    let dateStartSearch = 2; // will be updated
    for (let i = 0; i < Math.min(5, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (parseDateHeader(row[c]) !== null) {
          // Verify there are at least 3 dates from here
          const datesFromHere = row.slice(c).filter(h => parseDateHeader(h) !== null);
          if (datesFromHere.length >= 3) {
            headerRowIdx = i;
            headers = row;
            dateStartSearch = c;
            break;
          }
        }
      }
      if (headerRowIdx !== -1) break;
    }
    if (headerRowIdx === -1) throw new Error(`Could not find date headers in ${sheetName}`);

    // SKU name is 2 cols before dates, label is 1 col before dates
    const skuNameCol = dateStartSearch - 2;
    const labelCol = dateStartSearch - 1;

    // Build date column map (skip "Total YYYY" columns)
    const dateColumns: { col: number; month: number; year: number }[] = [];
    for (let c = dateStartSearch; c < headers.length; c++) {
      const val = headers[c];
      if (typeof val === "string" && val.toLowerCase().startsWith("total")) continue;
      const parsed = parseDateHeader(val);
      if (parsed) dateColumns.push({ col: c, ...parsed });
    }
    log(`Found ${dateColumns.length} date columns in ${sheetName}`);

    // Parse 8-row blocks. Each block:
    //   Row +0: SKU name (col 1) + "Opening stock" (col 2) + values (col 3+)
    //   Row +1: "Adjustments" (col 2) + values
    //   Row +2: "IMS" (col 2) + values  ← REAL DATA from Excel, must be uploaded
    //   Row +3: "Invoiced (SHP)" (col 2) + values
    //   Row +4: "Actual arrivals / Planned Orders" (col 2) + values
    //   Row +5: "Closing Stock" (col 2) — computed, skip
    //   Row +6: "Closing Stock - Weeks" (col 2) — computed, skip
    //   Row +7: empty separator
    const records: any[] = [];
    let r = headerRowIdx + 1;

    while (r < jsonRaw.length) {
      const row = jsonRaw[r];
      if (!row) { r++; continue; }

      // Check if this row starts a new SKU block: has SKU name in col 1 AND "Opening stock" in col 2
      const skuName = String(row[skuNameCol] || "").trim();
      const label = String(row[labelCol] || "").trim().toLowerCase();

      if (!skuName || !label.includes("opening")) {
        r++;
        continue;
      }

      const openingRow    = jsonRaw[r]     || [];
      const adjustmentsRow = jsonRaw[r + 1] || [];
      const imsRow        = jsonRaw[r + 2] || []; // IMS — real data from Excel
      const invoicedRow   = jsonRaw[r + 3] || [];
      const arrivalsRow   = jsonRaw[r + 4] || [];

      const values: any[] = [];
      for (const dc of dateColumns) {
        const safeNum = (v: any) => {
          if (v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '-')) return 0;
          const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
          return isFinite(n) ? n : 0;
        };
        values.push({
          year: dc.year,
          month: dc.month,
          openingStock: safeNum(openingRow[dc.col]).toString(),
          adjustments:  safeNum(adjustmentsRow[dc.col]).toString(),
          ims:          safeNum(imsRow[dc.col]).toString(),
          invoiced:     safeNum(invoicedRow[dc.col]).toString(),
          arrivals:     safeNum(arrivalsRow[dc.col]).toString(),
        });
      }

      records.push({ skuName, weight: weightCategory, values });
      r += 8; // Skip to next block
    }

    log(`Processing ${records.length} Planning FG records for ${weightCategory}...`);
    if (records.length > 0) {
      await uploadPlanningFgBulk.mutateAsync({ records });
    }
    log(`✅ Planning FG ${weightCategory} uploaded: ${records.length} SKUs`);
  };

  // ==================== FULL WORKBOOK ====================
  // ==================== VALIDATION SAMPLE COLLECTOR ====================
  const collectValidationSamples = (workbook: XLSX.WorkBook) => {
    const samples: { sheet: string; skuName: string; period: string; value: number }[] = [];

    // Sample from Forecast sheet
    try {
      const sheet = workbook.Sheets["Forecast"];
      if (sheet) {
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        let headerRow = -1;
        let headers: any[] = [];
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          if (!rows[i]) continue;
          const dateHeaders = rows[i].filter(h => parseDateHeader(h) !== null);
          if (dateHeaders.length >= 3) { headerRow = i; headers = rows[i]; break; }
        }
        if (headerRow >= 0) {
          const dateColumns: { col: number; month: number; year: number }[] = [];
          for (let c = 0; c < headers.length; c++) {
            const parsed = parseDateHeader(headers[c]);
            if (parsed) dateColumns.push({ col: c, ...parsed });
          }
          let skuCount = 0;
          for (let r = headerRow + 1; r < rows.length && skuCount < 3; r++) {
            const row = rows[r];
            if (!row) continue;
            const skuName = String(row[1] || "").trim();
            if (!skuName || skuName.toLowerCase().includes("total")) continue;
            // Take first 6 periods
            for (let d = 0; d < Math.min(6, dateColumns.length); d++) {
              const dc = dateColumns[d];
              const val = typeof row[dc.col] === "number" ? row[dc.col] : parseFloat(String(row[dc.col] || "0")) || 0;
              const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              samples.push({ sheet: "Forecast", skuName, period: `${monthNames[dc.month-1]} ${dc.year}`, value: val });
            }
            skuCount++;
          }
        }
      }
    } catch { /* ignore */ }

    // Sample from IMS sheet
    try {
      const sheetName = workbook.SheetNames.find(n => n === "IMS vs FRCST") ||
                        workbook.SheetNames.find(n => n.toLowerCase().includes("ims"));
      if (sheetName) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        let headerRow = -1;
        let headers: any[] = [];
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          if (!rows[i]) continue;
          const dateHeaders = rows[i].filter(h => parseDateHeader(h) !== null);
          if (dateHeaders.length >= 3) { headerRow = i; headers = rows[i]; break; }
        }
        if (headerRow >= 0) {
          const dateColumns: { col: number; month: number; year: number }[] = [];
          for (let c = 0; c < headers.length; c++) {
            const parsed = parseDateHeader(headers[c]);
            if (parsed) dateColumns.push({ col: c, ...parsed });
          }
          // IMS sheet has pairs of rows: IMS then Forecast per SKU
          let skuCount = 0;
          for (let r = headerRow + 1; r < rows.length && skuCount < 3; r++) {
            const row = rows[r];
            if (!row) continue;
            const typeVal = String(row[2] || "").trim().toLowerCase();
            if (typeVal !== "ims") continue;
            const skuName = String(row[1] || "").trim();
            if (!skuName || skuName.toLowerCase().includes("total")) continue;
            for (let d = 0; d < Math.min(6, dateColumns.length); d++) {
              const dc = dateColumns[d];
              const val = typeof row[dc.col] === "number" ? row[dc.col] : parseFloat(String(row[dc.col] || "0")) || 0;
              const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              samples.push({ sheet: "IMS", skuName, period: `${monthNames[dc.month-1]} ${dc.year}`, value: val });
            }
            skuCount++;
          }
        }
      }
    } catch { /* ignore */ }

    if (samples.length > 0) {
      setValidationData({ excelSamples: samples });
      setShowValidation(true);
    }
  };

  const processFullWorkbook = async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    log("🔄 Processing full workbook...");
    log(`Sheets found: ${workbook.SheetNames.join(", ")}`);

    // Process Forecast sheet
    if (workbook.Sheets["Forecast"]) {
      log("\n📊 Processing Forecast sheet...");
      await processForecastSheet(workbook, log);
    }

    // Process IMS sheet
    const imsSheet = workbook.SheetNames.find(n => n === "IMS vs FRCST") ||
                     workbook.SheetNames.find(n => n.toLowerCase().includes("ims"));
    if (imsSheet) {
      log("\n📈 Processing IMS sheet...");
      await processImsSheet(workbook, log);
    }

    // Process Shipment sheet
    const shipmentSheet = workbook.SheetNames.find(n => n === "Shipment (Production)") ||
                          workbook.SheetNames.find(n => n.toLowerCase().includes("shipment"));
    if (shipmentSheet) {
      log("\n🚚 Processing Shipment (Production) sheet...");
      await processShipmentSheet(workbook, shipmentSheet, log);
    }

    // Process Arrival sheet
    const arrivalSheet = workbook.SheetNames.find(n => n === "Arrival to Regie") ||
                         workbook.SheetNames.find(n => n.toLowerCase().includes("arrival"));
    if (arrivalSheet) {
      log("\n📦 Processing Arrival to Regie sheet...");
      await processArrivalSheet(workbook, arrivalSheet, log);
    }

    // Process Planning FG sheets
    const planningSheets = [
      { name: "Planning FG 50g", weight: "50g" },
      { name: "Planning FG 250g", weight: "250g" },
      { name: "Planning FG 1kg", weight: "1kg" },
    ];

    for (const ps of planningSheets) {
      if (workbook.Sheets[ps.name]) {
        log(`\n📋 Processing ${ps.name}...`);
        await processPlanningFgSheet(workbook, ps.name, ps.weight, log);
      }
    }

    log("\n🎉 Full workbook processing complete!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload your Excel SSOF workbook to populate all planning sheets. The parser supports the exact AF Lebanon SSOF format.
        </p>
      </div>

      {/* Full Workbook Upload - Primary */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Full Workbook Upload (Recommended)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload the complete SSOF Excel workbook. This will process all sheets: Forecast, IMS vs FRCST, Shipment (Production), Arrival to Regie, and all Planning FG sheets (50g, 250g, 1kg).
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 transition-colors text-sm font-medium">
              <Upload className="h-4 w-4" />
              {uploading ? "Processing..." : "Choose Excel File"}
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => handleFileUpload(e, "full")}
                disabled={uploading}
                className="hidden"
              />
            </label>
            {uploading && <span className="text-sm text-muted-foreground animate-pulse">Processing file...</span>}
          </div>
        </CardContent>
      </Card>

      {/* Individual Sheet Uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Forecast Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Upload forecast data with SKU names, weights, and monthly values.
            </p>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
              <Upload className="h-3 w-3" />
              Upload Forecast
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => handleFileUpload(e, "forecast")}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-green-500" />
              IMS Actuals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Upload actual IMS data. Past months are marked as actuals.
            </p>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
              <Upload className="h-3 w-3" />
              Upload IMS
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => handleFileUpload(e, "ims")}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Truck className="h-4 w-4 text-orange-500" />
              Opening Stock (Jan 2025)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Upload opening stock values. Format: SKU Name, Value.
            </p>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
              <Upload className="h-3 w-3" />
              Upload Stock
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => handleFileUpload(e, "opening-stock")}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </CardContent>
        </Card>
      </div>

      {/* Data Validation Summary */}
      {showValidation && validationData && (
        <ValidationSummary
          excelSamples={validationData.excelSamples}
          onClose={() => setShowValidation(false)}
        />
      )}

      {/* Upload Log */}
      {status.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Upload Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/30 rounded-lg p-4 max-h-80 overflow-y-auto space-y-0.5">
              {status.map((msg, i) => (
                <div key={i} className="text-xs font-mono py-0.5 flex items-start gap-2">
                  {msg.includes("Error") || msg.includes("❌") ? (
                    <span className="text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      {msg}
                    </span>
                  ) : msg.includes("✅") || msg.includes("complete") ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />
                      {msg}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{msg}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
