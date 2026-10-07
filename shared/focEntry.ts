import { mcPrecision, type FocCell } from "./performance/foc";

export type FocDraft = { date: string; flavor: string; weight: string; packaging: string; quantityMC: string; received: boolean; accType: string; salesManager: string; error?: string };
export type FocRecordedLine = { id: string; quantityMC: number; originalQuantityMC?: number; received: boolean; receiptDecision?: string; receiptReviewKey?: string | null; date?: string; flavor?: string; weight?: string; packaging?: string; accType: string; salesManager: string; source: "Recorded FOC" | "Existing FOC" | "Grid adjustment"; actor: string; recordedAt: string };
export type FocMatchSku = { id: number; name: string; weight: string; packagingType?: string | null; isActive?: boolean; country?: string };
export type FocMatchPeriod = { id: number; year: number; month: number; label: string; country?: string };
export const blankFocDraft = (): FocDraft => ({ date: "", flavor: "", weight: "", packaging: "New", quantityMC: "", received: false, accType: "", salesManager: "" });
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
export const focFlavor = (s: string) => ["twoapples", "doubleapples", "doubleapple"].includes(norm(s)) ? "doubleapple" : norm(s);
export const focWeight = (s: string) => ({ "1000gr": "1kg", "1000g": "1kg", "1kg": "1kg", "50gr": "50g", "50g": "50g", "250gr": "250g", "250g": "250g" }[norm(s)] ?? norm(s));
export const focPackaging = (s: string) => ({ oldpackaging: "old", newpackaging: "new" }[norm(s)] ?? norm(s));
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function focMonth(value: string): { year: number; month: number } | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2})(?:T.*)?)?$/.exec(v);
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    if (m[3] && (+m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate())) return null;
    return { year: +m[1], month: +m[2] };
  }
  m = /^([a-z]+)[\s/-]+(\d{2}|\d{4})$/i.exec(v);
  if (m) {
    const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const name = m[1].toLowerCase();
    const month = (name.length === 3 ? months.indexOf(name) : full.indexOf(name)) + 1;
    const year = +m[2] + (m[2].length === 2 ? 2000 : 0);
    if (month) return { year, month };
  }
  // Excel date serials use 1899-12-30 as their epoch.
  if (/^\d{5}(?:\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  return null;
}

function splitSheet(text: string) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === delimiter || ch === "\n" || ch === "\r")) {
      row.push(cell.trim()); cell = "";
      if (ch !== delimiter) { rows.push(row); row = []; if (ch === "\r" && text[i + 1] === "\n") i++; }
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return { rows: rows.filter(r => r.some(Boolean)), quoted };
}
export function parseFocPaste(text: string): FocDraft[] {
  const { rows, quoted } = splitSheet(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const headings = ["date", "acctype", "salesmanager", "flavor", "weight", "packaging", "quantityinmc"];
  const header = rows[0].map(norm);
  const hasHeader = header.includes("date") || header.includes("flavor");
  const missing = hasHeader ? headings.filter(h => !header.includes(h)) : [];
  const unexpected = hasHeader ? rows[0].filter((_, i) => !headings.includes(header[i]) || header.indexOf(header[i]) !== i) : [];
  const columns = hasHeader ? headings.map(h => header.indexOf(h)) : headings.map((_, i) => i);
  return (hasHeader ? rows.slice(1) : rows).map(r => ({
    date: r[columns[0]] ?? "", accType: r[columns[1]] ?? "", salesManager: r[columns[2]] ?? "",
    flavor: r[columns[3]] ?? "", weight: r[columns[4]] ?? "", packaging: r[columns[5]] ?? "",
    quantityMC: r[columns[6]] ?? "", received: false,
    ...(quoted ? { error: "Unclosed quote in pasted sheet." } : missing.length ? { error: `Missing column: ${missing.join(", ")}.` }
      : unexpected.length ? { error: `Unexpected or repeated column: ${unexpected.join(", ")}. Use the seven specified headings; no extra columns are accepted.` }
      : r.length !== (hasHeader ? header.length : 7) ? { error: "The row has the wrong number of columns; no values were guessed." } : {}),
  }));
}
export function matchFocDrafts(lines: FocDraft[], skus: FocMatchSku[], periods: FocMatchPeriod[], country: string) {
  return lines.map((line, index) => {
    const errors: string[] = line.error ? [line.error] : [];
    const month = focMonth(line.date);
    const ps = periods.filter(p => (!p.country || p.country === country) && p.year === month?.year && p.month === month?.month);
    const ss = skus.filter(s => s.isActive !== false && (!s.country || s.country === country) &&
      focFlavor(s.name) === focFlavor(line.flavor) && focWeight(s.weight) === focWeight(line.weight) &&
      focPackaging(s.packagingType ?? "New") === focPackaging(line.packaging));
    if (ss.length !== 1) errors.push(ss.length ? "More than one SKU matches. Choose an unambiguous SKU." : "No matching SKU in this country.");
    if (ps.length !== 1) errors.push(ps.length ? "More than one planning period matches." : "No matching month. Use Jun-26 or YYYY-MM.");
    const text = line.quantityMC.trim().replace(/,/g, "");
    const quantity = Number(text);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(line.quantityMC.trim()) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.99)
      errors.push("Enter a positive MC quantity, with at most two decimals.");
    return { ...line, row: index + 1, skuId: ss.length === 1 ? ss[0].id : null, periodId: ps.length === 1 ? ps[0].id : null,
      sku: ss.length === 1 ? `${ss[0].name} · ${ss[0].weight} · ${ss[0].packagingType ?? "New"}` : null,
      month: ps.length === 1 ? ps[0].label : null, quantity: mcPrecision(quantity || 0), errors };
  });
}
export function recordedFocLines(cell: FocCell, actor = "Existing record", recordedAt = ""): FocRecordedLine[] {
  return cell.lines?.length ? cell.lines : cell.value != null && Number(cell.value) > 0
    ? [{ id: "existing", quantityMC: Number(cell.value), received: !!cell.received, receiptDecision: cell.receiptDecision, receiptReviewKey: cell.receiptReviewKey, accType: "", salesManager: "", source: "Existing FOC", actor, recordedAt }] : [];
}

/** Preserve the incoming lines and their original quantities when a grid total is corrected. */
export function changeFocCell(cell: FocCell, change: { value?: number | null; received?: boolean; lineId?: string }, actor: string, recordedAt: string, id: string): FocCell {
  let lines = recordedFocLines(cell).map(l => ({ ...l }));
  if (change.value !== undefined) {
    const target = change.value ?? 0, current = Number(cell.value) || 0;
    if (target > current) lines.push({ id, quantityMC: mcPrecision(target - current), received: !!cell.received,
      accType: "", salesManager: "", source: "Grid adjustment", actor, recordedAt });
    else if (target < current) {
      let remaining = mcPrecision(current - target);
      // Remove unreceived balance first, then received quantities, from the most recent lines.
      for (const received of [false, true]) for (let i = lines.length - 1; i >= 0 && remaining > 0; i--) {
        const l = lines[i];
        if (l.received !== received) continue;
        const removed = Math.min(remaining, l.quantityMC);
        l.originalQuantityMC ??= l.quantityMC;
        l.quantityMC = mcPrecision(l.quantityMC - removed); remaining = mcPrecision(remaining - removed);
      }
    }
  }
  if (change.received !== undefined) {
    if (change.lineId && !lines.some(l => l.id === change.lineId)) throw new Error("Recorded FOC line not found. Refresh and review again.");
    lines = lines.map(l => !change.lineId || l.id === change.lineId ? { ...l, received: change.received! } : l);
  }
  const total = mcPrecision(lines.reduce((sum, l) => sum + l.quantityMC, 0));
  return { ...cell, value: change.value === null ? null : total.toFixed(2), lines,
    received: total > 0 && receivedFocMC({ ...cell, lines }) === total };
}
export function receivedFocMC(cell: FocCell) {
  return cell.lines?.length ? mcPrecision(cell.lines.reduce((sum, l) => sum + (l.received ? l.quantityMC : 0), 0)) : cell.received ? Number(cell.value) || 0 : 0;
}
