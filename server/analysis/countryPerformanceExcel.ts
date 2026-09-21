/**
 * Excel board pack — one sheet per section of the Country Performance pack.
 * Pure function of the pack so it can be unit tested without a database.
 * All quantities are exported in MC (master cases).
 */
import ExcelJS from "exceljs";
import type { BoardComparison } from "../../shared/performance/boardCompare";
import type { PerformancePack, Rag } from "./countryPerformance.types";

type Cell = string | number | null | undefined;

const ACCENT = "FF7F1D1D";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
const RAG_FILL: Record<Rag, string> = { green: "FFDCFCE7", amber: "FFFEF3C7", red: "FFFEE2E2", grey: "FFF3F4F6" };
const RAG_TEXT: Record<Rag, string> = { green: "On track", amber: "Watch", red: "Action needed", grey: "No data" };

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Number(v.toFixed(1)));
const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Math.round(v));
const fmtWeeks = (v: number | null | undefined) => (v === null || v === undefined ? "∞" : Number(v.toFixed(1)));

class SheetWriter {
  private row = 1;
  constructor(private ws: ExcelJS.Worksheet) {
    ws.properties.defaultColWidth = 16;
  }

  title(text: string, subtitle?: string) {
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.font = { bold: true, size: 14, color: { argb: ACCENT } };
    this.row++;
    if (subtitle) {
      this.ws.getCell(this.row, 1).value = subtitle;
      this.ws.getCell(this.row, 1).font = { italic: true, color: { argb: "FF6B7280" } };
      this.row++;
    }
    this.row++;
  }

  question(text: string) {
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.font = { bold: true, size: 12 };
    this.row++;
  }

  note(text: string) {
    this.ws.getCell(this.row, 1).value = text;
    this.ws.getCell(this.row, 1).font = { italic: true, color: { argb: "FF6B7280" } };
    this.row++;
  }

  blank(n = 1) {
    this.row += n;
  }

  keyValues(rows: [string, Cell][]) {
    for (const [k, v] of rows) {
      this.ws.getCell(this.row, 1).value = k;
      this.ws.getCell(this.row, 1).font = { bold: true };
      this.ws.getCell(this.row, 2).value = v ?? "–";
      this.row++;
    }
    this.row++;
  }

  table(headers: string[], rows: Cell[][], opts?: { ragColumn?: number; rags?: Rag[]; emptyMessage?: string }) {
    if (rows.length === 0) {
      this.note(opts?.emptyMessage ?? "No data for this period");
      this.row++;
      return;
    }
    headers.forEach((h, i) => {
      const c = this.ws.getCell(this.row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = HEADER_FILL;
      c.alignment = { wrapText: true, vertical: "middle" };
    });
    this.row++;
    rows.forEach((r, ri) => {
      r.forEach((v, i) => {
        const c = this.ws.getCell(this.row, i + 1);
        c.value = v === null || v === undefined ? "–" : v;
        if (typeof v === "number") c.numFmt = Number.isInteger(v) ? "#,##0" : "#,##0.0";
      });
      const rag = opts?.rags?.[ri];
      if (rag && opts?.ragColumn !== undefined) {
        const c = this.ws.getCell(this.row, opts.ragColumn + 1);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RAG_FILL[rag] } };
      }
      this.row++;
    });
    this.row++;
  }
}

function addSheet(wb: ExcelJS.Workbook, name: string): SheetWriter {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 0 }] });
  return new SheetWriter(ws);
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });

export interface WorkbookExtras {
  /** Comparison with the previous frozen board pack, when one exists. */
  comparison?: { previousName: string; previousDate: string; result: BoardComparison } | null;
  /** Presenter notes for this country + period. */
  notes?: { sectionId: string; body: string; author: string; updatedAt: string }[];
  /** Who last changed this country's data, and when (from the audit trail). */
  lastUpdate?: { at: string; by: string; what: string } | null;
}

export async function buildPerformanceWorkbook(pack: PerformancePack, extras: WorkbookExtras = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning";
  wb.created = new Date();
  const m = pack.meta;
  const isIntl = m.isIntl;
  let sheetNo = 0;
  const num = (title: string) => `${++sheetNo} ${title}`;
  const mc = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
  const noteFor = (sectionId: string) => extras.notes?.find((n) => n.sectionId === sectionId);
  const presenterNote = (s: SheetWriter, sectionId: string) => {
    const n = noteFor(sectionId);
    if (!n) return;
    s.question("Presenter notes");
    s.note(`${n.body} — ${n.author}, ${new Date(n.updatedAt).toLocaleDateString("en-GB")}`);
    s.blank();
  };

  // ── Cover ─────────────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, "Cover");
    s.title(`Country Performance — ${m.country}`, "Board pack generated by the SSOF planning system");
    s.keyValues([
      ["Period", m.window.label],
      ["Comparison", m.compareLabel],
      ["Data as of", m.dataAsOf ? fmtWhen(m.dataAsOf) : "not recorded"],
      ["Last update", extras.lastUpdate ? `${fmtWhen(extras.lastUpdate.at)} by ${extras.lastUpdate.by} (${extras.lastUpdate.what})` : "no data update recorded"],
      ["Generated", fmtWhen(m.generatedAt)],
      ["Active SKUs included", m.skuCount],
      ["Filters", describeFilters(m.filters) || "None"],
      ["Quantities", "Master cases (MC)"],
    ]);
    s.question("Sheets in this pack");
    s.table(
      ["#", "Section", "What it answers"],
      [
        [1, "Executive Summary", "How did the country perform, what matters, what needs a decision?"],
        [2, "Supply Chain Flow", "Where did volume go between plan and shelf?"],
        [3, "Demand", "Are we selling what we planned, and more than last year?"],
        [4, "Supply", "Did we produce, ship and clear what we planned?"],
        [5, "Inventory Health", "Which SKUs are thin, healthy or heavy?"],
        [6, "Forecast Quality", "How accurate and how biased is the forecast?"],
        [7, "Forward Look", "Where will stock land over the next six months?"],
        [8, "Commercial Value", "What is sell-out and stock worth at wholesale price?"],
        [9, "Data Confidence", "How much can we trust these numbers?"],
      ],
    );
  }

  // ── Running Rate ──────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Running Rate"));
    const r = pack.runningRate;
    s.title("Running Rate", r.asOf ? `Measured at ${r.asOf}` : "No actual IMS in this period");
    s.note(r.message);
    s.blank();
    s.question("How fast is the market running?");
    s.table(
      ["Measure", "MC / month", "Plan", "vs plan %", "Last year", "vs last year %", "Status"],
      [r.headline, r.avg3, r.avg6].map((f) => [f.label, mc(f.value), mc(f.plan), f.vsPlanPct, mc(f.lastYear), f.vsLyPct, RAG_TEXT[f.status]]),
      { ragColumn: 6, rags: [r.headline, r.avg3, r.avg6].map((f) => f.status) },
    );
    s.keyValues([
      ["Annualised (latest month × 12)", mc(r.annualised)],
      ["Closing stock (MC)", mc(r.closingStock)],
      ["Implied weeks of cover", r.coverWeeks === null ? "n/a" : Number(r.coverWeeks.toFixed(1))],
      ["Cover target", `${r.target.low}–${r.target.high} weeks`],
      ["Trend", r.trend.text],
    ]);
    s.question("By weight and by product type (3-month average)");
    s.table(
      ["Group", "SKUs", "Run rate (MC/month)", "Plan", "vs plan %", "Last year", "vs last year %", "Status"],
      [...r.byWeight, ...r.byType].map((t) => [t.group, t.skuCount, mc(t.current), mc(t.plan), t.vsPlanPct, mc(t.lastYear), t.vsLyPct, RAG_TEXT[t.status]]),
      { ragColumn: 7, rags: [...r.byWeight, ...r.byType].map((t) => t.status) },
    );
    s.question("Which SKUs are driving the run rate up or down?");
    s.table(["Direction", "SKU", "Weight", "Now (MC/month)", "3 months ago", "Change (MC)", "Change %"], [
      ...r.up.map((d) => ["Up", d.sku, d.weight, mc(d.current), mc(d.previous), mc(d.changeMc), d.changePct]),
      ...r.down.map((d) => ["Down", d.sku, d.weight, mc(d.current), mc(d.previous), mc(d.changeMc), d.changePct]),
    ], { emptyMessage: "No change in run rate by SKU" });
    s.question("24-month view");
    s.table(["Month", "Actual IMS", "3-month average", "6-month average", "Plan", "Last year"], r.chart.map((c) => [c.label, mc(c.ims), mc(c.rate3), mc(c.rate6), mc(c.plan), mc(c.lastYear)]));
    s.note(r.method);
    for (const n of r.notes) s.note(n);
    presenterNote(s, "runningRate");
  }

  // ── Full-Year Outlook ─────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Full-Year Outlook"));
    const o = pack.outlook;
    s.title(`Full-Year Outlook ${o.year}`, o.baseline.label);
    s.note(o.message);
    s.note(o.baseline.note);
    s.blank();
    s.question("Where will the year land against the annual plan?");
    const groups = [o.total, ...o.byWeight, ...o.byType];
    s.table(
      ["Group", "SKUs", "Actual to date (MC)", "Remaining forecast (MC)", "Landing (MC)", "Annual plan (MC)", "Gap (MC)", "Gap %", "Required MC/month", "Current MC/month", "Stretch %", "Status"],
      groups.map((g) => [g.group, g.skuCount, mc(g.ytdActual), mc(g.remainingForecast), mc(g.landing), mc(g.annualPlan), mc(g.gapMc), g.gapPct, mc(g.requiredRate), mc(g.currentRate), g.stretchPct, RAG_TEXT[g.status]]),
      { ragColumn: 11, rags: groups.map((g) => g.status) },
    );
    s.question("Month by month");
    s.table(["Month", "Actual", "Forecast", "Plan", "Cumulative landing", "Cumulative plan"], o.monthly.map((x) => [x.label, mc(x.actual), mc(x.forecast), mc(x.plan), mc(x.cumulativeLanding), mc(x.cumulativePlan)]));
    for (const n of o.notes) s.note(n);
    presenterNote(s, "outlook");
  }

  // ── Executive Summary ─────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Executive Summary"));
    s.title("Executive Summary", `${m.country} · ${m.window.label} · ${m.compareLabel}`);
    presenterNote(s, "executive");
    s.question("Key indicators");
    const tiles = pack.executive.tiles;
    s.table(
      ["Indicator", "Question", "Value", "Unit", "Plan", "vs plan", "vs plan %", "Last year", "vs last year", "vs last year %", "Previous period", "vs previous", "vs previous %", "Status", "Why"],
      tiles.map((t) => [
        t.label,
        t.question,
        t.value === null ? null : t.unit === "pct" || t.unit === "weeks" ? Number(t.value.toFixed(1)) : Math.round(t.value),
        t.unit === "MC" ? "MC" : t.unit === "pct" ? "%" : t.unit,
        t.vsPlan?.reference ?? null,
        t.vsPlan?.delta ?? null,
        t.vsPlan?.pct ?? (t.vsPlan?.note ?? null),
        t.vsLastYear?.reference ?? null,
        t.vsLastYear?.delta ?? null,
        t.vsLastYear?.pct ?? (t.vsLastYear?.note ?? null),
        t.vsPrevious?.reference ?? null,
        t.vsPrevious?.delta ?? null,
        t.vsPrevious?.pct ?? (t.vsPrevious?.note ?? null),
        RAG_TEXT[t.status],
        t.statusReason,
      ]),
      { ragColumn: 13, rags: tiles.map((t) => t.status) },
    );
    s.question("Key messages");
    s.table(
      ["#", "Tone", "Headline", "Detail", "Impact (MC)"],
      pack.executive.keyMessages.map((k) => [k.rank, k.tone, k.headline, k.detail, Math.round(k.impactMc)]),
      { emptyMessage: "No key messages for this period" },
    );
    s.question("Top risks and decisions");
    s.table(
      ["#", "SKU", "Weight", "Issue", "Impact (MC)", "Recommended action", "Severity"],
      pack.executive.risks.map((r) => [r.rank, r.sku, r.weight, r.issue, Math.round(r.impactMc), r.action, RAG_TEXT[r.severity]]),
      { ragColumn: 6, rags: pack.executive.risks.map((r) => r.severity), emptyMessage: "Nothing needs escalation this period" },
    );
    s.question("12-month trend behind each indicator");
    const labels = tiles[0]?.sparkline.map((p) => p.label) ?? [];
    s.table(["Indicator", ...labels], tiles.map((t) => [t.label, ...t.sparkline.map((p) => (p.value === null ? null : Number(p.value.toFixed(1))))]));
  }

  // ── What changed since the last board ─────────────────────────────────────
  {
    const s = addSheet(wb, num("Since Last Board"));
    s.title("What changed since the last board pack", extras.comparison ? `Compared with "${extras.comparison.previousName}" frozen on ${new Date(extras.comparison.previousDate).toLocaleDateString("en-GB")}` : "No previous frozen board pack for this country");
    if (extras.comparison) {
      const c = extras.comparison.result;
      s.note(c.summary);
      s.blank();
      s.question("Headline numbers");
      s.table(["Measure", "Previous pack", "This pack", "Change", "Change %"], c.changes.map((x) => [x.label, x.before, x.after, x.delta, x.pct]));
      s.question("Risks added");
      s.table(["SKU", "Issue", "Severity"], c.risksAdded.map((r) => [r.sku, r.issue, RAG_TEXT[r.severity]]), { emptyMessage: "No new risks" });
      s.question("Risks resolved");
      s.table(["SKU", "Issue", "Severity"], c.risksResolved.map((r) => [r.sku, r.issue, RAG_TEXT[r.severity]]), { emptyMessage: "No risks resolved" });
      s.question("Biggest forecast revisions (remaining months of the year)");
      s.table(["SKU", "Weight", "Previous forecast (MC)", "Current forecast (MC)", "Change (MC)", "Change %"], c.forecastRevisions.slice(0, 25).map((r) => [r.sku, r.weight, mc(r.before), mc(r.after), mc(r.delta), r.pct]), { emptyMessage: c.sameYear ? "No forecast revisions" : "Different planning year — not compared" });
    } else {
      s.note("Freeze a board pack from the page header to start tracking changes between boards.");
    }
    presenterNote(s, "changes");
  }

  // ── Supply Chain Flow ─────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Supply Chain Flow"));
    s.title("Supply Chain Flow", m.window.label);
    s.question("Where did the volume go between plan and shelf?");
    s.table(["Step", "Type", "Value (MC)", "Gap vs previous total (MC)", "Gap %", "Note"], pack.flow.waterfall.supply.map((w) => [w.label, w.kind, Math.round(w.value), w.gapMc === null ? null : Math.round(w.gapMc), w.gapPct, w.note ?? null]));
    s.question("How did stock move from opening to closing?");
    s.table(["Step", "Type", "Value (MC)", "Gap vs previous total (MC)", "Gap %", "Note"], pack.flow.waterfall.stock.map((w) => [w.label, w.kind, Math.round(w.value), w.gapMc === null ? null : Math.round(w.gapMc), w.gapPct, w.note ?? null]));
    s.question("What is in the pipeline today?");
    s.table(["Stage", "MC", "Weeks of cover", "Note"], pack.flow.pipeline.map((p) => [p.label, fmtNum(p.mc), p.weeksOfCover === null ? "–" : fmtWeeks(p.weeksOfCover), p.note ?? null]));
    s.question("How long does it take to reach the market?");
    s.table(["Measure", "Average days", "Fastest", "Slowest", "Batches measured", "Note"], pack.flow.leadTimes.map((l) => [l.label, fmtNum(l.avgDays), fmtNum(l.minDays), fmtNum(l.maxDays), l.sampleSize, l.note ?? null]));
    s.question("Which batches are late?");
    s.table(
      ["SKU", "Weight", "Production month", "Produced (MC)", "Cleared (MC)", "Pending (MC)", "Expected arrival", "Days late", "Status", "Invoice", "Container", "Note"],
      pack.flow.delayedBatches.map((b) => [b.sku, b.weight, b.productionPeriod, Math.round(b.producedMc), Math.round(b.clearedMc), Math.round(b.pendingMc), b.expectedArrival, b.daysLate, b.status, b.invoiceRef, b.containerRef, b.note]),
      { emptyMessage: isIntl ? "No delayed batches" : "Not tracked for Lebanon" },
    );
    pack.flow.notes.forEach((n) => s.note(n));
  }

  // ── 3 Demand ──────────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Demand"));
    s.title("Demand — sell-out (IMS)", m.chartWindow.label);
    presenterNote(s, "demand");
    s.question("Where did the growth come from? (volume bridge)");
    const br = pack.demand.bridge;
    if (br.available) {
      s.table(["Step", "Type", "MC", "Detail"], br.steps.map((x) => [x.label, x.kind === "total" ? "Total" : "Change", mc(x.value), x.detail ?? null]));
      s.table(["By weight", "Type", "MC"], br.byWeight.map((x) => [x.label, x.kind === "total" ? "Total" : "Change", mc(x.value)]));
    }
    s.note(br.note);
    s.blank();
    s.question("Are we selling what we planned, and more than last year?");
    s.table(["Month", "Sell-out (MC)", "Plan (MC)", "Last year (MC)", "3-month average", "6-month average", "Auto-filled"], pack.demand.monthly.map((d) => [d.label, fmtNum(d.ims), Math.round(d.plan), fmtNum(d.lastYear), fmtNum(d.runningRate3), fmtNum(d.runningRate6), d.autoFilled ? "Yes" : ""]));
    s.question("How does each month compare with last year?");
    s.table(["Month", "This year", "Last year", "Growth %", "Cumulative this year", "Cumulative last year", "Cumulative growth %"], pack.demand.yoy.map((y) => [y.label, fmtNum(y.current), fmtNum(y.lastYear), fmtPct(y.growthPct), fmtNum(y.cumulativeCurrent), fmtNum(y.cumulativeLastYear), fmtPct(y.cumulativeGrowthPct)]), { emptyMessage: "No prior year data" });
    s.question("Which months are naturally strong or weak?");
    s.table(["Month", "Seasonality index (1.0 = average)", "Years used", "Tag"], pack.demand.seasonality.map((p) => [p.label, p.index === null ? null : Number(p.index.toFixed(2)), p.yearsUsed, p.tag ?? ""]));
    for (const dim of pack.demand.mix) {
      s.question(`What is our mix by ${dim.dimension}?`);
      s.table(["Group", "MC", "Share %", "Share last year %", "Shift (pts)"], dim.rows.map((r) => [r.group, Math.round(r.mc), fmtPct(r.sharePct), fmtPct(r.lastYearSharePct), fmtPct(r.shiftPts)]));
    }
    s.question("Which SKUs make up 80% of sell-out?");
    s.table(["SKU", "Weight", "MC", "Share %", "Cumulative %", "In top 80%"], pack.demand.pareto.map((p) => [p.sku, p.weight, Math.round(p.mc), fmtPct(p.sharePct), fmtPct(p.cumulativePct), p.inTop80 ? "Yes" : ""]));
    const basis = pack.demand.moversBasis === "ly" ? "last year" : "previous period";
    s.question(`Who is growing vs ${basis}?`);
    s.table(["SKU", "Weight", "Current", "Reference", "Change (MC)", "Change %"], pack.demand.growers.map((g) => [g.sku, g.weight, Math.round(g.current), Math.round(g.reference), Math.round(g.deltaMc), fmtPct(g.deltaPct)]));
    s.question(`Who is declining vs ${basis}?`);
    s.table(["SKU", "Weight", "Current", "Reference", "Change (MC)", "Change %"], pack.demand.decliners.map((g) => [g.sku, g.weight, Math.round(g.current), Math.round(g.reference), Math.round(g.deltaMc), fmtPct(g.deltaPct)]));
    s.question("How much of sell-out comes from new products (NPI)?");
    s.keyValues([
      ["Core share %", fmtPct(pack.demand.npi.coreSharePct)],
      ["NPI share %", fmtPct(pack.demand.npi.npiSharePct)],
    ]);
    s.table(["Month", "Core %", "NPI %"], pack.demand.npi.byMonth.map((b) => [b.label, fmtPct(b.corePct), fmtPct(b.npiPct)]));
    s.table(["NPI SKU", "Weight", "Launch month", "Months since launch", "Total (MC)", ...(pack.demand.npi.ramps[0]?.ramp.map((r) => r.label) ?? [])], pack.demand.npi.ramps.map((r) => [r.sku, r.weight, r.launchMonth, r.monthsSinceLaunch, Math.round(r.totalMc), ...r.ramp.map((p) => fmtNum(p.value))]), { emptyMessage: "No NPI SKUs" });
    pack.demand.notes.forEach((n) => s.note(n));
  }

  // ── 4 Supply ──────────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Supply"));
    s.title(isIntl ? "Supply — production, arrivals and clearance" : "Supply — production and arrivals", m.chartWindow.label);
    s.question("Did we produce what we planned each month?");
    s.table(["Month", "Plan (MC)", "Actual (MC)", "Attainment %", "Cumulative plan", "Cumulative actual"], pack.supply.attainment.map((a) => [a.label, Math.round(a.plan), Math.round(a.actual), fmtPct(a.attainmentPct), Math.round(a.cumulativePlan), Math.round(a.cumulativeActual)]));
    s.question("Is production keeping pace with sell-out?");
    s.table(["Month", "Cumulative production", "Cumulative sell-out", "Gap (MC)"], pack.supply.cumulative.map((c) => [c.label, Math.round(c.cumulativeProduction), Math.round(c.cumulativeIms), Math.round(c.gap)]));
    s.question("Did shipments arrive when we expected?");
    s.keyValues([
      ["On-time %", fmtPct(pack.supply.onTimePct)],
      ["Note", pack.supply.onTimeNote],
    ]);
    s.table(["Month", "Planned (MC)", "Actual (MC)", "Variance (MC)"], pack.supply.arrivals.map((a) => [a.label, Math.round(a.planned), Math.round(a.actual), Math.round(a.variance)]));
    if (pack.supply.clearance) {
      const c = pack.supply.clearance;
      s.question("How much is cleared and how much is still waiting at customs?");
      s.keyValues([
        ["Cleared (MC)", Math.round(c.clearedMc)],
        ["Pending (MC)", Math.round(c.pendingMc)],
        ["Clearance rate %", fmtPct(c.clearanceRatePct)],
        ["Average days to clear", fmtNum(c.avgDaysToClear)],
        ["Median days to clear", fmtNum(c.medianDaysToClear)],
        ["Oldest pending", c.oldestPending ? `${c.oldestPending.sku} — ${c.oldestPending.productionPeriod}, ${Math.round(c.oldestPending.pendingMc)} MC, waiting ${c.oldestPending.daysWaiting ?? "–"} days` : "None"],
      ]);
      s.table(["Status", "Batches", "MC"], c.batchStatus.map((b) => [b.status, b.batches, Math.round(b.mc)]));
    }
    pack.supply.notes.forEach((n) => s.note(n));
  }

  // ── 5 Inventory Health ────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Inventory Health"));
    const inv = pack.inventory;
    s.title("Inventory Health", `Target ${inv.targetWeeks.low}–${inv.targetWeeks.high} weeks of cover · ${inv.coverFormula}`);
    s.question("Which SKUs are inside the target?");
    s.table(["Zone", "SKUs"], inv.zoneCounts.map((z) => [z.zone, z.count]));
    s.table(["SKU", "Weight", "Category", "Closing stock (MC)", "Weeks of cover", "Zone", "Monthly demand (MC)"], inv.cover.map((c) => [c.sku, c.weight, c.category, Math.round(c.closingStock), c.weeks === null ? "∞" : fmtWeeks(c.weeks), c.zone, Math.round(c.monthlyDemand)]));
    s.question("Where will stock be thin or heavy over the next 6 months? (weeks of cover)");
    s.table(["SKU", "Weight", ...inv.heatmap.months], inv.heatmap.rows.map((r) => [r.sku, r.weight, ...r.cells.map((c) => (c.weeks === null ? (c.closing > 0 ? "∞" : 0) : fmtWeeks(c.weeks)))]), { emptyMessage: "No future months in the planning horizon" });
    s.question("Which SKUs could run out, and when?");
    s.table(["SKU", "Weight", "Closing stock (MC)", "Weeks of cover", "Projected stock-out month", "Projected date", "Next arrival month", "Next arrival (MC)", "Shortfall before arrival (MC)"], inv.atRisk.map((a) => [a.sku, a.weight, Math.round(a.closingStock), a.weeks === null ? "∞" : fmtWeeks(a.weeks), a.projectedStockoutMonth, a.projectedStockoutDate, a.nextArrival?.month ?? "none planned", a.nextArrival ? Math.round(a.nextArrival.mc) : null, Math.round(a.shortfallMc)]), { emptyMessage: "No SKU is projected to run out in the next 6 months" });
    s.question("Where are we carrying too much stock?");
    s.table(["SKU", "Weight", "Closing stock (MC)", "Weeks of cover", "Excess above target (MC)", "Months to sell", "Monthly demand (MC)"], inv.overstock.map((o) => [o.sku, o.weight, Math.round(o.closingStock), o.weeks === null ? "∞" : fmtWeeks(o.weeks), Math.round(o.excessMc), o.monthsToSell === null ? "no sales" : Number(o.monthsToSell.toFixed(1)), Math.round(o.monthlyDemand)]), { emptyMessage: "No overstocked SKUs" });
    if (inv.expiryRisk) {
      s.question("How much stock may expire before it sells?");
      s.keyValues([["Total at risk (MC)", Math.round(inv.expiryRisk.totalAtRiskMc)]]);
      s.table(["SKU", "Weight", "Production period", "Expiry date", "Remaining (MC)", "Months until expiry", "At risk (MC)"], inv.expiryRisk.rows.map((r) => [r.sku, r.weight, r.productionPeriod, r.expiryDate, Math.round(r.remainingMc), r.monthsUntilExpiry, Math.round(r.atRiskMc)]), { emptyMessage: "No stock at risk of expiry" });
    }
    s.question("What is our stock worth at wholesale price?");
    s.keyValues([
      ["Stock value (USD)", inv.stockValue.valueUsd === null ? "Not valued — no wholesale prices set" : Math.round(inv.stockValue.valueUsd)],
      ["Volume with a price (MC)", Math.round(inv.stockValue.pricedMc)],
      ["Volume without a price (MC)", Math.round(inv.stockValue.unpricedMc)],
      ["Share of volume priced %", fmtPct(inv.stockValue.pricedSharePct)],
      ["SKUs missing a price", inv.stockValue.skusMissingPrice.join(", ") || "None"],
    ]);
    s.question("How much did we lose to stock-outs?");
    const ls = inv.lostSales;
    s.keyValues([
      ["Service level % (SKU-months in stock)", fmtPct(ls.serviceLevelPct)],
      ["SKU-months measured", ls.skuMonths],
      ["Stock-out SKU-months", ls.stockoutMonths],
      ["Estimated lost sales (MC)", mc(ls.lostMc)],
    ]);
    s.table(["SKU", "Weight", "Stock-out months", "Lost sales (MC)"], ls.bySku.map((r) => [r.sku, r.weight, r.months, mc(r.lostMc)]), { emptyMessage: "No stock-out months in the last 12 months" });
    s.table(["SKU", "Weight", "Month", "Closing (MC)", "Sold (MC)", "Run rate (MC)", "Lost (MC)"], ls.rows.map((r) => [r.sku, r.weight, r.month, mc(r.closing), mc(r.ims), mc(r.runRate), mc(r.lostMc)]), { emptyMessage: "No stock-out months" });
    s.note(ls.method);
    s.blank();
    s.question("How efficiently is stock working?");
    const ef = inv.efficiency;
    const efGroups = [ef.total, ...ef.byWeight];
    s.table(["Group", "Turns (annualised)", "Days of inventory", "Avg stock (MC)", "Annualised sales (MC)"], efGroups.map((g) => [g.group, g.turns === null ? null : Number(g.turns.toFixed(1)), g.daysOfInventory === null ? null : Math.round(g.daysOfInventory), mc(g.avgStock), mc(g.annualisedIms)]));
    s.question("Stock-to-sales trend");
    s.table(["Month", ...efGroups.map((g) => g.group)], ef.total.trend.map((pt, i) => [pt.label, ...efGroups.map((g) => { const v = g.trend[i]?.stockToSales; return v === null || v === undefined ? null : Number(v.toFixed(2)); })]));
    s.question("Demand variability and recommended safety stock");
    s.table(["SKU", "Weight", "Avg monthly sales (MC)", "Variability (CV)", "Volatility", "Recommended safety stock (weeks)", "Target weeks", "Current weeks", "Verdict"], ef.variability.map((v) => [v.sku, v.weight, mc(v.avgIms), v.cv === null ? null : Number(v.cv.toFixed(2)), v.volatility, v.recommendedWeeks === null ? null : Number(v.recommendedWeeks.toFixed(1)), v.targetWeeks, fmtWeeks(v.currentWeeks), v.verdict]), { emptyMessage: "Not enough history" });
    s.note(ef.method);
    inv.notes.forEach((n) => s.note(n));
    presenterNote(s, "inventory");
  }

  // ── 6 Forecast Quality ────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Forecast Quality"));
    const q = pack.forecastQuality;
    s.title("Forecast Quality", q.method);
    s.keyValues([
      ["Overall accuracy %", fmtPct(q.overallAccuracyPct)],
      ["Overall bias % (positive = forecast above actual)", fmtPct(q.overallBiasPct)],
      ["Auto-filled months excluded", q.excludedAutoFilledMonths],
    ]);
    s.question("How has accuracy moved month by month?");
    s.table(["Month", "Forecast (MC)", "Actual (MC)", "Accuracy %", "Bias %", "SKUs measured"], q.byMonth.map((p) => [p.label, Math.round(p.forecast), Math.round(p.actual), fmtPct(p.accuracyPct), fmtPct(p.biasPct), p.skusMeasured]));
    s.question("Which weights are hardest to forecast?");
    s.table(["Weight", "Forecast (MC)", "Actual (MC)", "Accuracy %", "Bias %", "Months measured"], q.byWeight.map((g) => [g.group, Math.round(g.forecast), Math.round(g.actual), fmtPct(g.accuracyPct), fmtPct(g.biasPct), g.monthsMeasured]));
    s.question("Which SKUs need a forecast review?");
    s.table(["SKU", "Weight", "Forecast (MC)", "Actual (MC)", "Accuracy %", "Bias %", "Months measured"], q.bySku.map((g) => [g.group, g.weight ?? "", Math.round(g.forecast), Math.round(g.actual), fmtPct(g.accuracyPct), fmtPct(g.biasPct), g.monthsMeasured]));
    s.question("Where is the forecast consistently wrong?");
    s.table(["SKU", "Weight", "Direction", "Consecutive months", "Average bias %"], q.chronic.map((c) => [c.sku, c.weight, c.direction === "over" ? "Over-forecast" : "Under-forecast", c.consecutiveMonths, fmtPct(c.avgBiasPct)]), { emptyMessage: "No SKU has been biased the same way for 3+ consecutive months" });
    q.notes.forEach((n) => s.note(n));
  }

  // ── Portfolio Health ──────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Portfolio Health"));
    const pf = pack.portfolio;
    s.title("SKU Portfolio Health", pf.basis);
    s.question("How is volume spread across the portfolio?");
    s.table(["Quadrant", "SKUs", "MC", "Share %"], pf.quadrantCounts.map((q) => [q.quadrant, q.count, mc(q.mc), q.sharePct]));
    s.question("Every SKU");
    s.table(["SKU", "Weight", "Flavour", "Category", "MC", "Share %", "Growth %", "Quadrant", "Closing stock (MC)"], pf.points.map((x) => [x.sku, x.weight, x.flavour, x.category, mc(x.mc), x.sharePct, x.growthPct, x.quadrant, mc(x.closingStock)]));
    s.question(`Tail report — ${pf.candidates} rationalisation candidates, ${Math.round(pf.tailStockMc).toLocaleString("en-US")} MC of stock in the tail`);
    s.table(["SKU", "Weight", "MC", "Share %", "Zero months (last 3)", "Months since last sale", "Stock (MC)", "Weeks of cover", "Candidate", "Reason"], pf.tail.map((t) => [t.sku, t.weight, mc(t.mc), t.sharePct, t.zeroMonthsLast3, t.monthsSinceLastSale, mc(t.stockMc), fmtWeeks(t.weeks), t.candidate ? "Yes" : "", t.reason]), { emptyMessage: "No tail SKUs" });
    s.question("Flavour ranking");
    s.table(["Rank", "Flavour", "Movement", "MC", "Share %", "Last year (MC)", "Growth %", "Last year rank"], pf.flavours.map((f) => [f.rank, f.flavour, f.movement, mc(f.mc), f.sharePct, mc(f.lastYearMc), f.growthPct, f.lastYearRank]));
    pf.notes.forEach((n) => s.note(n));
    presenterNote(s, "portfolio");
  }

  // ── Market Context ────────────────────────────────────────────────────────
  if (pack.market) {
    const s = addSheet(wb, num("Market Context"));
    const mk = pack.market;
    s.title("Market Context", `${mk.year} through month ${mk.monthsCovered} · ${mk.unit} · uploaded ${mk.source.uploadedAt ? new Date(mk.source.uploadedAt).toLocaleDateString("en-GB") : "n/a"}${mk.source.uploadedBy ? ` by ${mk.source.uploadedBy}` : ""}`);
    s.note(mk.message);
    s.blank();
    s.keyValues([
      ["Our brand", mk.ourBrand],
      ["Our share %", fmtPct(mk.sharePct)],
      ["Our share last year %", fmtPct(mk.shareLyPct)],
      ["Share change (pts)", fmtPct(mk.sharePtsChange)],
      ["Our growth %", fmtPct(mk.ourGrowthPct)],
      ["Market growth %", fmtPct(mk.marketGrowthPct)],
      ["Main competitor", mk.mainCompetitor ?? "n/a"],
      ["Main competitor growth %", fmtPct(mk.competitorGrowthPct)],
    ]);
    s.question("Brands");
    s.table(["Brand", "Year to date", "Last year", "Growth %", "Share %", "Share last year %", "Share change (pts)"], mk.brands.map((b) => [b.brand, mc(b.ytd), mc(b.lastYear), b.growthPct, b.sharePct, b.shareLyPct, b.sharePtsChange]));
    s.question("Share by month");
    s.table(["Month", "Our volume", "Market total", mk.mainCompetitor ?? "Main competitor", "Our share %", "Competitor share %"], mk.trend.map((x) => [x.label, mc(x.ours), mc(x.market), mc(x.competitor), x.sharePct, x.competitorSharePct]));
    mk.notes.forEach((n) => s.note(n));
    presenterNote(s, "market");
  }

  // ── Forward Look ──────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Forward Look"));
    const f = pack.forward;
    s.title("Forward Look — next 6 months", `${f.inputs.leadTimeNote} · Target ${f.inputs.target.low}–${f.inputs.target.high} weeks`);
    s.question("Where will stock land over the next 6 months? (plan demand, 0% scenario)");
    s.table(["Month", "Demand (MC)", "Arrivals (MC)", "Closing stock (MC)", "Weeks of cover", "Target low (MC)", "Target high (MC)"], f.total.map((t) => [t.label, Math.round(t.demand), Math.round(t.arrivals), Math.round(t.closing), t.weeks === null ? "∞" : fmtWeeks(t.weeks), Math.round(t.targetLowMc), Math.round(t.targetHighMc)]));
    for (const w of f.byWeight) {
      s.question(`Weight ${w.weight}`);
      s.table(["Month", "Demand (MC)", "Arrivals (MC)", "Closing stock (MC)", "Weeks of cover", "Target low (MC)", "Target high (MC)"], w.months.map((t) => [t.label, Math.round(t.demand), Math.round(t.arrivals), Math.round(t.closing), t.weeks === null ? "∞" : fmtWeeks(t.weeks), Math.round(t.targetLowMc), Math.round(t.targetHighMc)]));
    }
    s.question("What should we add or cut, and by when?");
    s.table(["SKU", "Weight", "Horizon month", "Projected closing (MC)", "Target closing (MC)", "Gap (MC)", "Action", "Order by"], f.gaps.map((g) => [g.sku, g.weight, g.horizonMonth, Math.round(g.projectedClosing), Math.round(g.targetClosing), Math.round(g.gapMc), g.action, g.orderByMonth ?? "now"]), { emptyMessage: "Every SKU is projected inside the target band" });
    f.notes.forEach((n) => s.note(n));
  }

  // ── 8 Commercial Value ────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Commercial Value"));
    const c = pack.commercial;
    s.title("Commercial Value", "USD at our wholesale price (priceToWs); SKUs without a price are not valued");
    if (!c.hasPrices) {
      s.note("No wholesale prices are set for this country yet. Add priceToWs in SKU Management to see values.");
    } else {
      s.keyValues([
        ["Sell-out value (USD)", fmtNum(c.selloutUsd)],
        ["Sell-out value last year (USD)", fmtNum(c.selloutLyUsd)],
        ["Stock value (USD)", fmtNum(c.stockUsd)],
        ["Share of volume priced %", fmtPct(c.pricedVolumeSharePct)],
      ]);
      s.question("How does value split by weight?");
      s.table(["Weight", "Sell-out (USD)", "Last year (USD)", "Growth %", "Stock (USD)", "% priced"], c.byWeight.map((r) => [r.group, fmtNum(r.selloutUsd), fmtNum(r.selloutLyUsd), fmtPct(r.selloutGrowthPct), fmtNum(r.stockUsd), fmtPct(r.pricedSharePct)]));
      s.question("How does value split by category?");
      s.table(["Category", "Sell-out (USD)", "Last year (USD)", "Growth %", "Stock (USD)", "% priced"], c.byCategory.map((r) => [r.group, fmtNum(r.selloutUsd), fmtNum(r.selloutLyUsd), fmtPct(r.selloutGrowthPct), fmtNum(r.stockUsd), fmtPct(r.pricedSharePct)]));
      s.question("Which SKUs are not valued?");
      s.table(["SKU"], c.skusMissingPrice.map((x) => [x]), { emptyMessage: "Every active SKU has a price" });
    }
    c.notes.forEach((n) => s.note(n));
  }

  // ── Anomalies ─────────────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Anomalies"));
    const an = pack.anomalies;
    s.title("Anomalies", `${an.rows.length} unusual month${an.rows.length === 1 ? "" : "s"} across ${an.monthsScanned} months scanned`);
    s.table(["Scope", "Name", "Weight", "Measure", "Month", "Value (MC)", "Expected (MC)", "Deviation (MC)", "Deviation %", "Z-score", "Direction", "Severity", "Likely explanation"], an.rows.map((r) => [r.scope === "sku" ? "SKU" : "Weight", r.name, r.weight, r.measure, r.month, mc(r.value), mc(r.expected), mc(r.deviationMc), r.deviationPct, r.zScore, r.direction, RAG_TEXT[r.severity], r.explanation]), { ragColumn: 11, rags: an.rows.map((r) => r.severity), emptyMessage: "No unusual months found" });
    s.note(an.method);
    an.notes.forEach((n) => s.note(n));
    presenterNote(s, "anomalies");
  }

  // ── Data Confidence ───────────────────────────────────────────────────────
  {
    const s = addSheet(wb, num("Data Confidence"));
    const d = pack.confidence;
    s.title("Data Confidence", `Score ${d.score}/100 — ${d.grade}`);
    s.question("Issues");
    s.table(["Severity", "Issue", "Detail", "Count"], d.issues.map((i) => [RAG_TEXT[i.severity], i.title, i.detail, i.count]), { ragColumn: 0, rags: d.issues.map((i) => i.severity), emptyMessage: "No data issues found" });
    s.question("Does closing stock match Planning FG?");
    s.keyValues([
      ["Result", d.reconciliation.ok ? "Matches" : "Mismatch"],
      ["Month checked", d.reconciliation.month ?? "–"],
      ["SKUs checked", d.reconciliation.checkedSkus],
      ["Note", d.reconciliation.note],
    ]);
    s.table(["SKU", "Weight", "Pack closing (MC)", "Planning FG closing (MC)", "Difference (MC)"], d.reconciliation.mismatches.map((r) => [r.sku, r.weight, Math.round(r.packClosing), Math.round(r.planningFgClosing), Math.round(r.difference)]), { emptyMessage: "No mismatches" });
    s.question("When was each sheet last updated?");
    s.table(["Sheet", "Last updated"], d.freshness.map((f) => [f.sheet, f.lastUpdated ?? "never"]));
    s.question("Missing IMS months");
    s.table(["SKU", "Weight", "Months"], d.missingImsMonths.map((r) => [r.sku, r.weight, r.months.join(", ")]), { emptyMessage: "No missing IMS months" });
    s.question("SKUs without a forecast");
    s.table(["SKU", "Weight"], d.skusWithoutForecast.map((r) => [r.sku, r.weight]), { emptyMessage: "Every SKU has a forecast" });
    s.keyValues([
      ["Auto-filled IMS months", d.autoFilledImsMonths],
      ["SKUs missing a price", d.skusMissingPrice.join(", ") || "None"],
    ]);
  }

  // ── Presenter notes ───────────────────────────────────────────────────────
  if (extras.notes?.length) {
    const s = addSheet(wb, "Presenter Notes");
    s.title("Presenter notes", `${m.country} · ${m.window.label}`);
    s.table(["Section", "Note", "Author", "Updated"], extras.notes.map((n) => [n.sectionId, n.body, n.author, new Date(n.updatedAt).toLocaleString("en-GB")]));
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function describeFilters(f: PerformancePack["meta"]["filters"]): string {
  const parts: string[] = [];
  if (f.weights?.length) parts.push(`Weight: ${f.weights.join(", ")}`);
  if (f.categories?.length) parts.push(`Category: ${f.categories.join(", ")}`);
  if (f.packaging?.length) parts.push(`Packaging: ${f.packaging.join(", ")}`);
  if (f.flavours?.length) parts.push(`Flavour: ${f.flavours.join(", ")}`);
  return parts.join(" · ");
}
