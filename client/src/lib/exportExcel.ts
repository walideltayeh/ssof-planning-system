import * as XLSX from "xlsx";

interface Sku {
  id: number;
  name: string;
  weight: string;
  category: string;
  isExcludedFromTotal: boolean | null;
}

interface Period {
  id: number;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

interface ForecastRow { skuId: number; periodId: number; value: string | null }
interface ImsRow { skuId: number; periodId: number; value: string | null; isActual: boolean | null }
interface ShipmentRow { skuId: number; periodId: number; week1: string | null; week2: string | null; week3: string | null; week4: string | null }
interface ArrivalRow { skuId: number; periodId: number; week1: string | null; week2: string | null; week3: string | null; week4: string | null }
interface PlanningFgRow { skuId: number; periodId: number; openingStock: string | null; adjustments: string | null; invoiced: string | null; arrivals: string | null }

interface ExportData {
  skus: Sku[];
  periods: Period[];
  forecast: ForecastRow[];
  ims: ImsRow[];
  shipment: ShipmentRow[];
  arrival: ArrivalRow[];
  planningFg: PlanningFgRow[];
}

function buildMap<T>(data: T[], keyFn: (d: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const d of data) map.set(keyFn(d), d);
  return map;
}

function num(val: string | null | undefined): number {
  return parseFloat(val ?? "0") || 0;
}

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

function sortSkus(skus: Sku[]): Sku[] {
  return [...skus].sort((a, b) => {
    const catA = a.category === "Core" ? 0 : 1;
    const catB = b.category === "Core" ? 0 : 1;
    if (catA !== catB) return catA - catB;
    const wA = WEIGHT_ORDER[a.weight] ?? 9;
    const wB = WEIGHT_ORDER[b.weight] ?? 9;
    if (wA !== wB) return wA - wB;
    return a.name.localeCompare(b.name);
  });
}

function groupSkus(skus: Sku[]): { category: string; skus: Sku[] }[] {
  const sorted = sortSkus(skus);
  const groups: { category: string; skus: Sku[] }[] = [];
  let currentCat = "";
  for (const sku of sorted) {
    if (sku.category !== currentCat) {
      currentCat = sku.category;
      groups.push({ category: currentCat, skus: [] });
    }
    groups[groups.length - 1].skus.push(sku);
  }
  return groups;
}

function buildForecastSheet(skus: Sku[], periods: Period[], forecast: ForecastRow[]): XLSX.WorkSheet {
  const fMap = buildMap(forecast, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(skus);
  const rows: (string | number)[][] = [];

  // Header row
  const header: (string | number)[] = ["Category", "Weight", "SKU Name"];
  for (const p of periods) header.push(p.label);
  rows.push(header);

  // Data rows grouped by Core/NPI
  for (const group of groups) {
    for (const sku of group.skus) {
      const row: (string | number)[] = [sku.category, sku.weight, sku.name];
      for (const p of periods) {
        const d = fMap.get(`${sku.id}-${p.id}`);
        row.push(num(d?.value));
      }
      rows.push(row);
    }

    // Category subtotal
    const subRow: (string | number)[] = ["", "", `Subtotal ${group.category}`];
    for (const p of periods) {
      let total = 0;
      for (const sku of group.skus) {
        total += num(fMap.get(`${sku.id}-${p.id}`)?.value);
      }
      subRow.push(total);
    }
    rows.push(subRow);
  }

  // Grand total row
  const totalRow: (string | number)[] = ["", "", "GRAND TOTAL"];
  for (const p of periods) {
    let total = 0;
    for (const sku of skus) {
      total += num(fMap.get(`${sku.id}-${p.id}`)?.value);
    }
    totalRow.push(total);
  }
  rows.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 30 }, ...periods.map(() => ({ wch: 10 }))];
  return ws;
}

function buildImsVsForecastSheet(skus: Sku[], periods: Period[], forecast: ForecastRow[], ims: ImsRow[]): XLSX.WorkSheet {
  const fMap = buildMap(forecast, d => `${d.skuId}-${d.periodId}`);
  const iMap = buildMap(ims, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(skus);
  const rows: (string | number)[][] = [];

  // Header row
  const header: (string | number)[] = ["Category", "Weight", "SKU Name", "Row"];
  for (const p of periods) header.push(p.label);
  rows.push(header);

  // Data rows grouped by Core/NPI
  for (const group of groups) {
    for (const sku of group.skus) {
      const fRow: (string | number)[] = [sku.category, sku.weight, sku.name, "Forecast"];
      const iRow: (string | number)[] = ["", "", "", "IMS"];
      const vRow: (string | number)[] = ["", "", "", "Variance"];

      for (const p of periods) {
        const fVal = num(fMap.get(`${sku.id}-${p.id}`)?.value);
        const iVal = num(iMap.get(`${sku.id}-${p.id}`)?.value);
        fRow.push(fVal);
        iRow.push(iVal);
        vRow.push(iVal - fVal);
      }
      rows.push(fRow, iRow, vRow);
    }

    // Category subtotals (Forecast, IMS, Variance)
    const subF: (string | number)[] = ["", "", `Subtotal ${group.category}`, "Forecast"];
    const subI: (string | number)[] = ["", "", "", "IMS"];
    const subV: (string | number)[] = ["", "", "", "Variance"];
    for (const p of periods) {
      let fTotal = 0, iTotal = 0;
      for (const sku of group.skus) {
        fTotal += num(fMap.get(`${sku.id}-${p.id}`)?.value);
        iTotal += num(iMap.get(`${sku.id}-${p.id}`)?.value);
      }
      subF.push(fTotal);
      subI.push(iTotal);
      subV.push(iTotal - fTotal);
    }
    rows.push(subF, subI, subV);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 30 }, { wch: 10 }, ...periods.map(() => ({ wch: 10 }))];
  return ws;
}

function buildWeeklySheet(
  _sheetName: string,
  skus: Sku[],
  periods: Period[],
  data: ShipmentRow[] | ArrivalRow[]
): XLSX.WorkSheet {
  const dMap = buildMap(data, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(skus);
  const rows: (string | number)[][] = [];

  // Header row 1: month labels spanning 5 columns each
  const header1: (string | number)[] = ["Category", "Weight", "SKU Name"];
  for (const p of periods) {
    header1.push(p.label, "", "", "", "");
  }
  rows.push(header1);

  // Header row 2: W1, W2, W3, W4, Total for each month
  const header2: (string | number)[] = ["", "", ""];
  for (const _p of periods) {
    header2.push("W1", "W2", "W3", "W4", "Total");
  }
  rows.push(header2);

  // Data rows grouped by Core/NPI
  for (const group of groups) {
    for (const sku of group.skus) {
      const row: (string | number)[] = [sku.category, sku.weight, sku.name];
      for (const p of periods) {
        const d = dMap.get(`${sku.id}-${p.id}`);
        const w1 = num(d?.week1);
        const w2 = num(d?.week2);
        const w3 = num(d?.week3);
        const w4 = num(d?.week4);
        row.push(w1, w2, w3, w4, w1 + w2 + w3 + w4);
      }
      rows.push(row);
    }

    // Category subtotal
    const subRow: (string | number)[] = ["", "", `Subtotal ${group.category}`];
    for (const p of periods) {
      let tw1 = 0, tw2 = 0, tw3 = 0, tw4 = 0;
      for (const sku of group.skus) {
        const d = dMap.get(`${sku.id}-${p.id}`);
        tw1 += num(d?.week1);
        tw2 += num(d?.week2);
        tw3 += num(d?.week3);
        tw4 += num(d?.week4);
      }
      subRow.push(tw1, tw2, tw3, tw4, tw1 + tw2 + tw3 + tw4);
    }
    rows.push(subRow);
  }

  // Grand total row
  const totalRow: (string | number)[] = ["", "", "GRAND TOTAL"];
  for (const p of periods) {
    let tw1 = 0, tw2 = 0, tw3 = 0, tw4 = 0;
    for (const sku of skus) {
      const d = dMap.get(`${sku.id}-${p.id}`);
      tw1 += num(d?.week1);
      tw2 += num(d?.week2);
      tw3 += num(d?.week3);
      tw4 += num(d?.week4);
    }
    totalRow.push(tw1, tw2, tw3, tw4, tw1 + tw2 + tw3 + tw4);
  }
  rows.push(totalRow);

  // Merge header cells for month labels
  const merges: XLSX.Range[] = [];
  for (let i = 0; i < periods.length; i++) {
    const startCol = 3 + i * 5;
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 4 } });
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 30 }, ...Array(periods.length * 5).fill(null).map(() => ({ wch: 8 }))];
  return ws;
}

/**
 * Build the Arrival to Regie sheet with formula-computed values from Shipment data.
 * For months from 2026-02 onward, arrival values are computed from shipment:
 *   W1 = Shipment(M-1).W3, W2 = Shipment(M-1).W4, W3 = Shipment(M).W1, W4 = Shipment(M).W2
 * For 2026-01: W3 = Shipment(M).W1, W4 = Shipment(M).W2 (W1/W2 raw)
 * For 2025-12: W4 = Shipment(M).W2 (W1/W2/W3 raw)
 * For earlier months: all raw data
 */
function buildArrivalSheet(
  skus: Sku[],
  periods: Period[],
  arrivalData: ArrivalRow[],
  shipmentData: ShipmentRow[]
): XLSX.WorkSheet {
  const aMap = buildMap(arrivalData, d => `${d.skuId}-${d.periodId}`);
  const sMap = buildMap(shipmentData, d => `${d.skuId}-${d.periodId}`);
  const periodByYM = new Map<string, Period>();
  for (const p of periods) periodByYM.set(`${p.year}-${p.month}`, p);

  const groups = groupSkus(skus);
  const rows: (string | number)[][] = [];

  // Header row 1
  const header1: (string | number)[] = ["Category", "Weight", "SKU Name"];
  for (const p of periods) header1.push(p.label, "", "", "", "");
  rows.push(header1);

  // Header row 2
  const header2: (string | number)[] = ["", "", ""];
  for (const _p of periods) header2.push("W1", "W2", "W3", "W4", "Total");
  rows.push(header2);

  function getArrivalWeekValue(skuId: number, period: Period, weekKey: 'week1' | 'week2' | 'week3' | 'week4'): number {
    const { year, month } = period;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    const getShip = (y: number, m: number, wk: 'week1' | 'week2' | 'week3' | 'week4'): number => {
      const sp = periodByYM.get(`${y}-${m}`);
      if (!sp) return 0;
      const d = sMap.get(`${skuId}-${sp.id}`);
      return num(d?.[wk]);
    };

    // Before 2025-12: raw
    if (year < 2025 || (year === 2025 && month < 12)) {
      const d = aMap.get(`${skuId}-${period.id}`);
      return num(d?.[weekKey]);
    }
    // 2025-12: only W4 is formula
    if (year === 2025 && month === 12) {
      if (weekKey === 'week4') return getShip(2025, 12, 'week2');
      const d = aMap.get(`${skuId}-${period.id}`);
      return num(d?.[weekKey]);
    }
    // 2026-01: W3 and W4 are formula
    if (year === 2026 && month === 1) {
      if (weekKey === 'week3') return getShip(2026, 1, 'week1');
      if (weekKey === 'week4') return getShip(2026, 1, 'week2');
      const d = aMap.get(`${skuId}-${period.id}`);
      return num(d?.[weekKey]);
    }
    // 2026-02+: full formula
    switch (weekKey) {
      case 'week1': return getShip(prevYear, prevMonth, 'week3');
      case 'week2': return getShip(prevYear, prevMonth, 'week4');
      case 'week3': return getShip(year, month, 'week1');
      case 'week4': return getShip(year, month, 'week2');
    }
  }

  for (const group of groups) {
    for (const sku of group.skus) {
      const row: (string | number)[] = [sku.category, sku.weight, sku.name];
      for (const p of periods) {
        const w1 = getArrivalWeekValue(sku.id, p, 'week1');
        const w2 = getArrivalWeekValue(sku.id, p, 'week2');
        const w3 = getArrivalWeekValue(sku.id, p, 'week3');
        const w4 = getArrivalWeekValue(sku.id, p, 'week4');
        row.push(w1, w2, w3, w4, w1 + w2 + w3 + w4);
      }
      rows.push(row);
    }

    const subRow: (string | number)[] = ["", "", `Subtotal ${group.category}`];
    for (const p of periods) {
      let tw1 = 0, tw2 = 0, tw3 = 0, tw4 = 0;
      for (const sku of group.skus) {
        tw1 += getArrivalWeekValue(sku.id, p, 'week1');
        tw2 += getArrivalWeekValue(sku.id, p, 'week2');
        tw3 += getArrivalWeekValue(sku.id, p, 'week3');
        tw4 += getArrivalWeekValue(sku.id, p, 'week4');
      }
      subRow.push(tw1, tw2, tw3, tw4, tw1 + tw2 + tw3 + tw4);
    }
    rows.push(subRow);
  }

  const totalRow: (string | number)[] = ["", "", "GRAND TOTAL"];
  for (const p of periods) {
    let tw1 = 0, tw2 = 0, tw3 = 0, tw4 = 0;
    for (const sku of skus) {
      tw1 += getArrivalWeekValue(sku.id, p, 'week1');
      tw2 += getArrivalWeekValue(sku.id, p, 'week2');
      tw3 += getArrivalWeekValue(sku.id, p, 'week3');
      tw4 += getArrivalWeekValue(sku.id, p, 'week4');
    }
    totalRow.push(tw1, tw2, tw3, tw4, tw1 + tw2 + tw3 + tw4);
  }
  rows.push(totalRow);

  const merges: XLSX.Range[] = [];
  for (let i = 0; i < periods.length; i++) {
    const startCol = 3 + i * 5;
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 4 } });
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 30 }, ...Array(periods.length * 5).fill(null).map(() => ({ wch: 8 }))];
  return ws;
}

function buildPlanningFgSheet(
  weight: string,
  skus: Sku[],
  periods: Period[],
  ims: ImsRow[],
  planningFg: PlanningFgRow[]
): XLSX.WorkSheet {
  const filteredSkus = skus.filter(s => s.weight === weight);
  const sorted = [...filteredSkus].sort((a, b) => {
    const catA = a.category === "Core" ? 0 : 1;
    const catB = b.category === "Core" ? 0 : 1;
    if (catA !== catB) return catA - catB;
    return a.name.localeCompare(b.name);
  });
  const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  const iMap = buildMap(ims, d => `${d.skuId}-${d.periodId}`);
  const pMap = buildMap(planningFg, d => `${d.skuId}-${d.periodId}`);

  const ROW_LABELS = [
    "Opening Stock",
    "Adjustments",
    "IMS",
    "Invoiced (SHP)",
    "Actual arrivals / Planned Orders",
    "Closing Stock",
    "Closing Stock - Weeks",
  ];

  const rows: (string | number)[][] = [];

  // Header row
  const header: (string | number)[] = ["Category", "SKU Name", "Row"];
  for (const p of sortedPeriods) header.push(p.label);
  rows.push(header);

  for (const sku of sorted) {
    // Calculate all derived values
    let prevClosingStock = 0;
    const values: Map<string, number[]> = new Map();
    for (const label of ROW_LABELS) values.set(label, []);

    for (let i = 0; i < sortedPeriods.length; i++) {
      const p = sortedPeriods[i];
      const planData = pMap.get(`${sku.id}-${p.id}`);
      const imsVal = num(iMap.get(`${sku.id}-${p.id}`)?.value);
      const invoicedVal = num(planData?.invoiced);
      const arrivalsVal = num(planData?.arrivals);

      let openingStock: number;
      if (i === 0) {
        openingStock = num(planData?.openingStock);
      } else {
        openingStock = prevClosingStock;
      }

      const adjustments = num(planData?.adjustments);
      const closingStock = openingStock + adjustments - imsVal + arrivalsVal;

      // Weeks of Stock = (Closing Stock / AVG(next 2 months IMS)) * 4.3
      let weeksOfStock = 0;
      if (i < sortedPeriods.length - 2) {
        const next1 = num(iMap.get(`${sku.id}-${sortedPeriods[i + 1].id}`)?.value);
        const next2 = num(iMap.get(`${sku.id}-${sortedPeriods[i + 2].id}`)?.value);
        const avg = (next1 + next2) / 2;
        if (avg > 0) weeksOfStock = (closingStock / avg) * 4.3;
      } else if (i < sortedPeriods.length - 1) {
        const next1 = num(iMap.get(`${sku.id}-${sortedPeriods[i + 1].id}`)?.value);
        if (next1 > 0) weeksOfStock = (closingStock / next1) * 4.3;
      }

      values.get("Opening Stock")!.push(openingStock);
      values.get("Adjustments")!.push(adjustments);
      values.get("IMS")!.push(imsVal);
      values.get("Invoiced (SHP)")!.push(invoicedVal);
      values.get("Actual arrivals / Planned Orders")!.push(arrivalsVal);
      values.get("Closing Stock")!.push(closingStock);
      values.get("Closing Stock - Weeks")!.push(Math.round(weeksOfStock * 100) / 100);

      prevClosingStock = closingStock;
    }

    // Write rows for this SKU
    for (let r = 0; r < ROW_LABELS.length; r++) {
      const label = ROW_LABELS[r];
      const row: (string | number)[] = [r === 0 ? sku.category : "", r === 0 ? sku.name : "", label];
      const vals = values.get(label)!;
      for (const v of vals) row.push(v);
      rows.push(row);
    }

    // Add empty separator row
    rows.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 28 }, ...sortedPeriods.map(() => ({ wch: 10 }))];
  return ws;
}

export function exportToExcel(data: ExportData) {
  const { skus, periods, forecast, ims, shipment, arrival, planningFg } = data;
  const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  const wb = XLSX.utils.book_new();

  // 1. Forecast sheet
  const forecastWs = buildForecastSheet(skus, sortedPeriods, forecast);
  XLSX.utils.book_append_sheet(wb, forecastWs, "Forecast");

  // 2. IMS vs FRCST sheet
  const imsVsForecastWs = buildImsVsForecastSheet(skus, sortedPeriods, forecast, ims);
  XLSX.utils.book_append_sheet(wb, imsVsForecastWs, "IMS vs FRCST");

  // 3. Shipment (Production) sheet
  const shipmentWs = buildWeeklySheet("Shipment (Production)", skus, sortedPeriods, shipment);
  XLSX.utils.book_append_sheet(wb, shipmentWs, "Shipment (Production)");

  // 4. Arrival to Regie sheet (uses formula-computed values from Shipment data)
  const arrivalWs = buildArrivalSheet(skus, sortedPeriods, arrival, shipment);
  XLSX.utils.book_append_sheet(wb, arrivalWs, "Arrival to Regie");

  // 5. Planning FG sheets by weight
  const weights = ["50g", "250g", "1kg"];
  for (const w of weights) {
    const hasSkus = skus.some(s => s.weight === w);
    if (hasSkus) {
      const planningWs = buildPlanningFgSheet(w, skus, sortedPeriods, ims, planningFg);
      XLSX.utils.book_append_sheet(wb, planningWs, `Planning FG ${w}`);
    }
  }

  // Generate and download
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `SSOF_Planning_Export_${dateStr}.xlsx`);
}
