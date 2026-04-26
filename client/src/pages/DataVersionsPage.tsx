import { useState, useCallback, useRef } from "react";
import { ValidationSummary } from "@/components/ValidationSummary";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  BarChart3,
  Package,
  Truck,
  CheckCircle2,
  AlertCircle,
  Save,
  Download,
  Trash2,
  FileText,
  RotateCcw,
  HardDrive,
  Cloud,
  Clock,
  User,
  AlertTriangle,
} from "lucide-react";
import VersionComparison from "@/components/VersionComparison";
import VersionComments from "@/components/VersionComments";

// ==================== UPLOAD HELPERS ====================

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseDateHeader(val: any): { month: number; year: number } | null {
  if (!val) return null;
  if (val instanceof Date) {
    const m = val.getMonth() + 1;
    const y = val.getFullYear();
    if (y >= 2024 && y <= 2030) return { month: m, year: y };
    return null;
  }
  const str = String(val).trim();
  for (const [name, num] of Object.entries(MONTHS)) {
    if (str.toLowerCase().startsWith(name.toLowerCase())) {
      const rest = str.slice(name.length).trim();
      let yr = parseInt(rest);
      if (yr < 100) yr += 2000;
      if (yr >= 2024 && yr <= 2030) return { month: num, year: yr };
    }
  }
  if (!isNaN(Number(str))) {
    try {
      const d = XLSX.SSF.parse_date_code(Number(str));
      if (d && d.y >= 2024 && d.y <= 2030) return { month: d.m, year: d.y };
    } catch { /* ignore */ }
  }
  return null;
}

function normalizeWeight(weight: string, skuName: string): string {
  const w = String(weight).trim().toLowerCase();
  if (w === "50g" || w === "250g" || w === "1kg") return w;
  if (w === "1000" || w === "1000g" || w.includes("1kg") || w.includes("1000")) return "1kg";
  if (w === "250" || w.includes("250")) return "250g";
  if (w === "50" || (w.includes("50") && !w.includes("250"))) return "50g";
  const nameLower = skuName.toLowerCase();
  if (nameLower.includes("1kg") || nameLower.includes("1 kg") || nameLower.includes("1000g")) return "1kg";
  if (nameLower.includes("250g") || nameLower.includes("250 g")) return "250g";
  if (nameLower.includes("50g") || nameLower.includes("50 g")) return "50g";
  return "50g";
}

// ==================== MAIN COMPONENT ====================

export default function DataVersionsPage() {
  const { isAdmin, country } = useAppAuth();
  const uploadCountry = country || "Lebanon";

  // --- Upload state ---
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [validationData, setValidationData] = useState<{
    excelSamples: { sheet: string; skuName: string; period: string; value: number }[];
  } | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  // --- Version state ---
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [versionDescription, setVersionDescription] = useState("");
  const [loadConfirmId, setLoadConfirmId] = useState<number | null>(null);
  const [loadConfirmName, setLoadConfirmName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [importConfirmData, setImportConfirmData] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- tRPC hooks ---
  const utils = trpc.useUtils();
  const uploadForecast = trpc.upload.forecast.useMutation();
  const uploadIms = trpc.upload.imsActuals.useMutation();
  const uploadOpeningStock = trpc.upload.openingStock.useMutation();
  const uploadShipment = trpc.upload.shipment.useMutation();
  const uploadArrival = trpc.upload.arrival.useMutation();
  const uploadPlanningFgBulk = trpc.upload.planningFgBulk.useMutation();

  const versionCountry = uploadCountry;
  const versionsQuery = trpc.versions.list.useQuery({ country: versionCountry as any });
  const editCountQuery = trpc.versions.editCount.useQuery({ country: versionCountry as any });
  const saveMutation = trpc.versions.save.useMutation();
  const loadMutation = trpc.versions.load.useMutation();
  const deleteMutation = trpc.versions.delete.useMutation();
  const importMutation = trpc.versions.import.useMutation();

  const addStatus = useCallback((msg: string) => {
    setStatus(prev => [...prev, msg]);
  }, []);

  // ==================== UPLOAD PARSERS ====================

  const processForecastSheet = useCallback(async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    const sheet = workbook.Sheets["Forecast"] || workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No Forecast sheet found");
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in Forecast sheet`);
    let headerRow = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(10, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) { headerRow = i; headers = row; break; }
    }
    if (headerRow === -1) throw new Error("Could not find date headers in Forecast sheet");
    log(`Header row found at index ${headerRow}`);
    const weightCol = 0;
    const skuCol = 1;
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
    await uploadForecast.mutateAsync({ records, country: uploadCountry });
    log(`✅ Forecast data uploaded: ${records.length} SKUs`);
  }, [uploadForecast, uploadCountry]);

  const processImsSheet = useCallback(async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
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
    await uploadIms.mutateAsync({ records, country: uploadCountry });
    log(`✅ IMS data uploaded: ${records.length} SKUs`);
  }, [uploadIms, uploadCountry]);

  const processOpeningStockSheet = useCallback(async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("No sheet found");
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${json.length} rows`);
    const records: any[] = [];
    for (let r = 1; r < json.length; r++) {
      const row = json[r];
      if (!row) continue;
      const skuName = String(row[0] || "").trim();
      const val = row[1];
      const numVal = typeof val === "number" ? val : parseFloat(String(val || "0")) || 0;
      if (!skuName) continue;
      records.push({ skuName, value: numVal.toString() });
    }
    log(`Processing ${records.length} opening stock records...`);
    await uploadOpeningStock.mutateAsync({ records, country: uploadCountry });
    log(`✅ Opening stock uploaded: ${records.length} SKUs`);
  }, [uploadOpeningStock, uploadCountry]);

  const parseWeeklySheet = useCallback((workbook: XLSX.WorkBook, sheetName: string, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in ${sheetName}`);

    let monthHeaderRow = -1;
    let weekHeaderRow = -1;
    let monthHeaders: any[] = [];
    let weekHeaders: any[] = [];

    for (let i = 0; i < Math.min(10, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) {
        monthHeaderRow = i;
        monthHeaders = row;
        if (jsonRaw[i + 1]) {
          weekHeaderRow = i + 1;
          weekHeaders = jsonRaw[i + 1];
        }
        break;
      }
    }
    if (monthHeaderRow === -1) throw new Error(`Could not find date headers in ${sheetName}`);

    const hasWeekCols = weekHeaders.some(h => String(h || "").trim().match(/^W[1-4]$/i));

    type MonthGroup = { month: number; year: number; w1Col: number; w2Col: number; w3Col: number; w4Col: number; totalCol: number };
    const monthGroups: MonthGroup[] = [];

    if (hasWeekCols) {
      log(`Detected weekly columns (W1-W4 + Total) structure`);
      for (let c = 0; c < monthHeaders.length; c++) {
        const parsed = parseDateHeader(monthHeaders[c]);
        if (!parsed) continue;
        const w1 = String(weekHeaders[c] || "").trim().toUpperCase();
        if (w1 === "W1") {
          monthGroups.push({
            ...parsed,
            w1Col: c,
            w2Col: c + 1,
            w3Col: c + 2,
            w4Col: c + 3,
            totalCol: c + 4,
          });
        }
      }
    } else {
      log(`Detected simple monthly columns (no W1-W4)`);
      for (let c = 0; c < monthHeaders.length; c++) {
        const parsed = parseDateHeader(monthHeaders[c]);
        if (parsed) {
          monthGroups.push({ ...parsed, w1Col: c, w2Col: -1, w3Col: -1, w4Col: -1, totalCol: c });
        }
      }
    }

    log(`Found ${monthGroups.length} month groups`);

    const dataStartRow = hasWeekCols ? weekHeaderRow + 1 : monthHeaderRow + 1;
    const weightCol = 0;
    const skuCol = 1;

    const records: any[] = [];
    for (let r = dataStartRow; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[skuCol] || "").trim();
      const rawWeight = String(row[weightCol] || "").trim();
      if (!skuName || skuName.toLowerCase().includes("total")) continue;
      const weight = normalizeWeight(rawWeight, skuName);
      const values: any[] = [];
      for (const mg of monthGroups) {
        const readVal = (col: number) => {
          if (col < 0 || col >= (row.length || 0)) return "0";
          const v = row[col];
          if (v === null || v === undefined || v === "") return "0";
          const n = typeof v === "number" ? v : parseFloat(String(v)) || 0;
          return String(Math.round(n));
        };
        if (hasWeekCols) {
          const w1 = readVal(mg.w1Col);
          const w2 = readVal(mg.w2Col);
          const w3 = readVal(mg.w3Col);
          const w4 = readVal(mg.w4Col);
          const wSum = parseFloat(w1) + parseFloat(w2) + parseFloat(w3) + parseFloat(w4);
          const totalVal = readVal(mg.totalCol);
          if (wSum === 0 && parseFloat(totalVal) !== 0) {
            values.push({
              year: mg.year,
              month: mg.month,
              week1: totalVal,
              week2: "0",
              week3: "0",
              week4: "0",
            });
          } else {
            values.push({
              year: mg.year,
              month: mg.month,
              week1: w1,
              week2: w2,
              week3: w3,
              week4: w4,
            });
          }
        } else {
          values.push({
            year: mg.year,
            month: mg.month,
            value: readVal(mg.totalCol),
          });
        }
      }
      records.push({ skuName, weight, values });
    }
    return records;
  }, []);

  const processShipmentSheet = useCallback(async (workbook: XLSX.WorkBook, sheetName: string, log: (msg: string) => void) => {
    const records = parseWeeklySheet(workbook, sheetName, log);
    log(`Processing ${records.length} shipment records...`);
    await uploadShipment.mutateAsync({ records, country: uploadCountry });
    log(`✅ Shipment data uploaded: ${records.length} SKUs`);
  }, [parseWeeklySheet, uploadShipment, uploadCountry]);

  const processArrivalSheet = useCallback(async (workbook: XLSX.WorkBook, sheetName: string, log: (msg: string) => void) => {
    const records = parseWeeklySheet(workbook, sheetName, log);
    log(`Processing ${records.length} arrival records...`);
    await uploadArrival.mutateAsync({ records, country: uploadCountry });
    log(`✅ Arrival data uploaded: ${records.length} SKUs`);
  }, [parseWeeklySheet, uploadArrival, uploadCountry]);

  const processPlanningFgSheet = useCallback(async (workbook: XLSX.WorkBook, sheetName: string, weight: string, log: (msg: string) => void) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    log(`Found ${jsonRaw.length} rows in ${sheetName}`);
    let headerRow = -1;
    let headers: any[] = [];
    for (let i = 0; i < Math.min(10, jsonRaw.length); i++) {
      const row = jsonRaw[i];
      if (!row) continue;
      const dateHeaders = row.filter(h => parseDateHeader(h) !== null);
      if (dateHeaders.length >= 3) { headerRow = i; headers = row; break; }
    }
    if (headerRow === -1) { log(`⚠️ No date headers found in ${sheetName}, skipping`); return; }
    const skuCol = 1;
    const typeCol = 2;
    const dateColumns: { col: number; month: number; year: number }[] = [];
    for (let c = 0; c < headers.length; c++) {
      const parsed = parseDateHeader(headers[c]);
      if (parsed) dateColumns.push({ col: c, ...parsed });
    }
    const skuMap = new Map<string, { skuName: string; weight: string; rows: Map<string, any[]> }>();
    for (let r = headerRow + 1; r < jsonRaw.length; r++) {
      const row = jsonRaw[r];
      if (!row) continue;
      const skuName = String(row[skuCol] || "").trim();
      const rowType = String(row[typeCol] || "").trim().toUpperCase();
      if (!skuName || skuName.toLowerCase().includes("total")) continue;
      if (!skuMap.has(skuName)) skuMap.set(skuName, { skuName, weight, rows: new Map() });
      const skuEntry = skuMap.get(skuName)!;
      const values: any[] = [];
      for (const dc of dateColumns) {
        const val = row[dc.col];
        const numVal = typeof val === "number" ? val : parseFloat(String(val || "0")) || 0;
        values.push({ year: dc.year, month: dc.month, value: numVal.toString() });
      }
      skuEntry.rows.set(rowType, values);
    }
    const records = Array.from(skuMap.values()).map(s => {
      const findRow = (...keys: string[]) => {
        for (const k of keys) {
          const exact = s.rows.get(k);
          if (exact) return exact;
        }
        for (const [rowKey, rowVal] of s.rows.entries()) {
          const lk = rowKey.toLowerCase();
          for (const k of keys) {
            if (lk.includes(k.toLowerCase())) return rowVal;
          }
        }
        return undefined;
      };
      const openingStockRow = findRow("OPENING STOCK", "OPENING", "OP. STOCK", "OP STOCK");
      const adjustmentsRow = findRow("ADJUSTMENTS", "ADJUSTMENT", "ADJ");
      const invoicedRow = findRow("INVOICED", "INVOICE", "INV", "SHP");
      const arrivalsRow = findRow("ARRIVALS", "ARRIVAL", "PLANNED ORDERS", "ACTUAL ARRIVALS");
      const imsRow = findRow("IMS", "SALES", "ACTUAL");
      const values = dateColumns.map((dc, idx) => ({
        year: dc.year,
        month: dc.month,
        openingStock: openingStockRow?.[idx]?.value ?? "0",
        adjustments: adjustmentsRow?.[idx]?.value ?? "0",
        invoiced: invoicedRow?.[idx]?.value ?? "0",
        arrivals: arrivalsRow?.[idx]?.value ?? "0",
        ims: imsRow?.[idx]?.value,
      }));
      return { skuName: s.skuName, weight: s.weight, values };
    });
    log(`Processing ${records.length} Planning FG records for ${sheetName}...`);
    await uploadPlanningFgBulk.mutateAsync({ records, country: uploadCountry });
    log(`✅ Planning FG ${sheetName} uploaded: ${records.length} SKUs`);
  }, [uploadPlanningFgBulk, uploadCountry]);

  const collectValidationSamples = useCallback((workbook: XLSX.WorkBook) => {
    const samples: { sheet: string; skuName: string; period: string; value: number }[] = [];
    try {
      const forecastSheet = workbook.Sheets["Forecast"];
      if (forecastSheet) {
        const rows = XLSX.utils.sheet_to_json(forecastSheet, { header: 1 }) as any[][];
        let headerRow = -1;
        let headers: any[] = [];
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const row = rows[i];
          if (!row) continue;
          const dh = row.filter(h => parseDateHeader(h) !== null);
          if (dh.length >= 3) { headerRow = i; headers = row; break; }
        }
        if (headerRow !== -1) {
          const dateColumns: { col: number; month: number; year: number }[] = [];
          for (let c = 0; c < headers.length; c++) {
            const p = parseDateHeader(headers[c]);
            if (p) dateColumns.push({ col: c, ...p });
          }
          let skuCount = 0;
          for (let r = headerRow + 1; r < rows.length && skuCount < 3; r++) {
            const row = rows[r];
            if (!row) continue;
            const skuName = String(row[1] || "").trim();
            if (!skuName || skuName.toLowerCase().includes("total")) continue;
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
    if (samples.length > 0) {
      setValidationData({ excelSamples: samples });
      setShowValidation(true);
    }
  }, []);

  const processFullWorkbook = useCallback(async (workbook: XLSX.WorkBook, log: (msg: string) => void) => {
    log("🔄 Processing full workbook...");
    log(`Sheets found: ${workbook.SheetNames.join(", ")}`);

    const recognized = new Set<string>();

    const forecastSheet = workbook.SheetNames.find(n => n === "Forecast");
    if (forecastSheet) {
      recognized.add(forecastSheet);
      log("\n📊 Processing Forecast sheet...");
      await processForecastSheet(workbook, log);
    }

    const imsSheet = workbook.SheetNames.find(n => n === "IMS vs FRCST") ||
                     workbook.SheetNames.find(n => n.toLowerCase().includes("ims") && n.toLowerCase().includes("frcst"));
    if (imsSheet) {
      recognized.add(imsSheet);
      log("\n📈 Processing IMS vs Forecast sheet...");
      await processImsSheet(workbook, log);
    }

    const shipmentSheet = workbook.SheetNames.find(n => n === "Shipment (Production)") ||
                          workbook.SheetNames.find(n => n.toLowerCase().includes("shipment"));
    if (shipmentSheet) {
      recognized.add(shipmentSheet);
      log("\n🚚 Processing Shipment (Production) sheet...");
      await processShipmentSheet(workbook, shipmentSheet, log);
    }

    const arrivalSheet = workbook.SheetNames.find(n => n === "Arrival to Regie") ||
                         workbook.SheetNames.find(n => n.toLowerCase().includes("arrival"));
    if (arrivalSheet) {
      recognized.add(arrivalSheet);
      log("\n📦 Processing Arrival to Regie sheet...");
      await processArrivalSheet(workbook, arrivalSheet, log);
    }

    const planningSheets = [
      { name: "Planning FG 50g", weight: "50g" },
      { name: "Planning FG 250g", weight: "250g" },
      { name: "Planning FG 1kg", weight: "1kg" },
    ];
    for (const ps of planningSheets) {
      if (workbook.Sheets[ps.name]) {
        recognized.add(ps.name);
        log(`\n📋 Processing ${ps.name}...`);
        await processPlanningFgSheet(workbook, ps.name, ps.weight, log);
      }
    }

    const skipped = workbook.SheetNames.filter(n => !recognized.has(n));
    if (skipped.length > 0) {
      log(`\n⏭️ Skipped sheets (not needed): ${skipped.join(", ")}`);
    }

    log("\n🎉 Full workbook processing complete!");
  }, [processForecastSheet, processImsSheet, processShipmentSheet, processArrivalSheet, processPlanningFgSheet]);

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
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.shipment.invalidate();
      utils.data.arrival.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
      utils.country.skus.invalidate();
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
  }, [addStatus, utils, processForecastSheet, processImsSheet, processOpeningStockSheet, processFullWorkbook, collectValidationSamples]);

  // ==================== VERSION HANDLERS ====================

  const handleSave = async () => {
    if (!versionName.trim()) { toast.error("Please enter a version name"); return; }
    try {
      const result = await saveMutation.mutateAsync({
        name: versionName.trim(),
        description: versionDescription.trim() || undefined,
        country: versionCountry as any,
      });
      toast.success(`Version "${versionName}" saved successfully!`, {
        description: result.docUrl ? "Word document generated and attached." : "Version snapshot saved.",
      });
      setSaveDialogOpen(false);
      setVersionName("");
      setVersionDescription("");
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to save version", { description: err.message || "Unknown error" });
    }
  };

  const handleLoad = async (id: number) => {
    try {
      const result = await loadMutation.mutateAsync({ id });
      toast.success(`Version "${result.name}" loaded successfully!`, {
        description: "All data has been restored. Refresh any open pages to see the changes.",
      });
      setLoadConfirmId(null);
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to load version", { description: err.message || "Unknown error" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success(`Version "${deleteConfirmName}" deleted`);
      setDeleteConfirmId(null);
      versionsQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to delete version", { description: err.message || "Unknown error" });
    }
  };

  const handleExport = async (id: number, name: string) => {
    try {
      const response = await fetch(`/api/trpc/versions.export?input=${encodeURIComponent(JSON.stringify({ id }))}`);
      const json = await response.json();
      const data = json.result?.data;
      if (!data) throw new Error("No data returned");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.ssof.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported "${name}" to file`);
    } catch (err: any) {
      toast.error("Failed to export version", { description: err.message || "Unknown error" });
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.snapshotData) {
          toast.error("Invalid version file", { description: "The file does not contain valid SSOF snapshot data." });
          return;
        }
        setImportConfirmData(data);
      } catch {
        toast.error("Failed to read file", { description: "The file is not valid JSON." });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImportConfirm = async () => {
    if (!importConfirmData) return;
    try {
      const result = await importMutation.mutateAsync({ versionData: importConfirmData, country: uploadCountry as any });
      toast.success(`Version "${result.name}" imported and loaded!`, {
        description: "All data has been restored from the imported file. Refresh any open pages.",
      });
      setImportConfirmData(null);
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to import version", { description: err.message || "Unknown error" });
    }
  };

  const versions = versionsQuery.data || [];
  const editCount = editCountQuery.data?.count ?? 0;

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data & Versions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload Excel data into the system and manage saved SSOF version snapshots.
        </p>
      </div>

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="upload" className="tab-dark-red">Upload Data</TabsTrigger>
          <TabsTrigger value="versions" className="relative tab-dark-red">
            Version Manager
            {editCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {editCount > 99 ? "99+" : editCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== UPLOAD TAB ===== */}
        <TabsContent value="upload" className="space-y-6">
          {!isAdmin && (
            <div className="p-8 text-center">
              <h2 className="text-lg font-semibold text-destructive">Access Denied</h2>
              <p className="text-sm text-muted-foreground mt-2">Only administrators can upload data.</p>
            </div>
          )}
          {isAdmin && (
            <>
              {/* Full Workbook Upload */}
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
                    <p className="text-xs text-muted-foreground">Upload forecast data with SKU names, weights, and monthly values.</p>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
                      <Upload className="h-3 w-3" />
                      Upload Forecast
                      <input type="file" accept=".xlsx,.xls" onChange={e => handleFileUpload(e, "forecast")} disabled={uploading} className="hidden" />
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
                    <p className="text-xs text-muted-foreground">Upload actual IMS data. Past months are marked as actuals.</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
                        <Upload className="h-3 w-3" />
                        Upload IMS
                        <input type="file" accept=".xlsx,.xls" onChange={e => handleFileUpload(e, "ims")} disabled={uploading} className="hidden" />
                      </label>
                      <a
                        href={`/api/export-ims-template?country=${encodeURIComponent(uploadCountry)}`}
                        className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md hover:bg-muted/50 transition-colors text-xs font-medium"
                      >
                        <Download className="h-3 w-3" />
                        Download Template
                      </a>
                    </div>
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
                    <p className="text-xs text-muted-foreground">Upload opening stock values. Format: SKU Name, Value.</p>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs font-medium">
                      <Upload className="h-3 w-3" />
                      Upload Stock
                      <input type="file" accept=".xlsx,.xls" onChange={e => handleFileUpload(e, "opening-stock")} disabled={uploading} className="hidden" />
                    </label>
                  </CardContent>
                </Card>
              </div>

              {/* Validation Summary */}
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
            </>
          )}
        </TabsContent>

        {/* ===== VERSION MANAGER TAB ===== */}
        <TabsContent value="versions" className="space-y-6">
          {/* Version Manager Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">SSOF Version Manager</h2>
              <p className="text-muted-foreground text-sm mt-0.5">
                Save, load, compare, and annotate SSOF data snapshots
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Compare button */}
              <VersionComparison versions={versions} />

              {/* Import from device */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.ssof.json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!isAdmin}>
                <Upload className="h-4 w-4 mr-2" />
                Import from Device
              </Button>

              {/* Save new version */}
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!isAdmin}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Current Version
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Save SSOF Version — {versionCountry}</DialogTitle>
                    <DialogDescription>
                      Save the current state of {versionCountry} data as a named version. A Word document summarizing changes will be auto-generated.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Version Name *</label>
                      <Input
                        placeholder="e.g., SSOFv1, March 2025 Baseline, Pre-Season Plan"
                        value={versionName}
                        onChange={(e) => setVersionName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
                      <Textarea
                        placeholder="Describe what this version represents or what changes were made..."
                        value={versionDescription}
                        onChange={(e) => setVersionDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
                    <Button
                      onClick={handleSave}
                      disabled={!versionName.trim() || saveMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {saveMutation.isPending ? (
                        <><span className="animate-spin mr-2">&#9203;</span>Saving...</>
                      ) : (
                        <><Save className="h-4 w-4 mr-2" />Save Version</>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Unsaved edits banner */}
          {editCount > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-center gap-3 py-3">
                <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">
                    {editCount} unsaved edit{editCount !== 1 ? "s" : ""} since last version
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Consider saving a new version to preserve your recent changes.
                  </p>
                </div>
                <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => setSaveDialogOpen(true)} disabled={!isAdmin}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save Now
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Versions List */}
          {versionsQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : versions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">No Saved Versions</h3>
                <p className="text-muted-foreground text-sm text-center max-w-md">
                  Save your first version to create a snapshot of all SSOF data. Each version includes a Word document summarizing all changes made.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {versions.map((version, idx) => (
                <Card
                  key={version.id}
                  className={`transition-all hover:shadow-md ${idx === 0 ? "border-emerald-200 bg-emerald-50/30" : ""}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${idx === 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          <Cloud className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2">
                            {version.name}
                            {idx === 0 && (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">Latest</Badge>
                            )}
                          </CardTitle>
                          {version.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">{version.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {version.docUrl && (
                          <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => window.open(version.docUrl!, "_blank")}>
                            <FileText className="h-3.5 w-3.5 mr-1.5" />
                            Word Doc
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => handleExport(version.id, version.name)}>
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Export
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-amber-600 border-amber-200 hover:bg-amber-50"
                          disabled={!isAdmin}
                          onClick={() => { setLoadConfirmId(version.id); setLoadConfirmName(version.name); }}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Load
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          disabled={!isAdmin}
                          onClick={() => { setDeleteConfirmId(version.id); setDeleteConfirmName(version.name); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{version.savedBy}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(version.createdAt).toLocaleString()}</span>
                      <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />Full data snapshot</span>
                    </div>
                    <VersionComments versionId={version.id} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Load Confirmation Dialog */}
      <AlertDialog open={loadConfirmId !== null} onOpenChange={(open) => { if (!open) setLoadConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load Version "{loadConfirmName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace ALL current data (SKUs, Forecast, IMS, Shipment, Arrival, Planning FG) with the data from this saved version. This action cannot be undone. Make sure to save the current state first if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => loadConfirmId && handleLoad(loadConfirmId)} className="bg-amber-600 hover:bg-amber-700" disabled={loadMutation.isPending}>
              {loadMutation.isPending ? "Loading..." : "Yes, Load Version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Version "{deleteConfirmName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this saved version and its associated Word document. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)} className="bg-red-600 hover:bg-red-700" disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Confirmation Dialog */}
      <AlertDialog open={importConfirmData !== null} onOpenChange={(open) => { if (!open) setImportConfirmData(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Version "{importConfirmData?.name || "Unknown"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace ALL current data with the data from the imported file. The imported version was originally saved by{" "}
              <strong>{importConfirmData?.savedBy || "unknown"}</strong> on{" "}
              <strong>{importConfirmData?.createdAt ? new Date(importConfirmData.createdAt).toLocaleString() : "unknown date"}</strong>.
              This action cannot be undone. Make sure to save the current state first if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleImportConfirm} className="bg-amber-600 hover:bg-amber-700" disabled={importMutation.isPending}>
              {importMutation.isPending ? "Importing..." : "Yes, Import & Load"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
