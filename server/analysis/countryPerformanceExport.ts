/**
 * Query parsing + access check for the Excel board-pack HTTP route.
 * Kept separate from the Express file so it can be unit tested.
 */
import * as db from "../db";
import type { CompareMode, PerformanceCountry, PerformanceRequest, PeriodPreset } from "./countryPerformance.types";

const COUNTRIES: PerformanceCountry[] = ["Lebanon", "Syria", "Libya", "KSA"];
const PRESETS: PeriodPreset[] = ["month", "qtd", "ytd", "l12m", "custom"];
const COMPARES: CompareMode[] = ["plan", "ly", "prev"];
const YM = /^\d{4}-\d{2}$/;

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function list(v: unknown): string[] | undefined {
  const s = str(v);
  if (!s) return undefined;
  const xs = s.split(",").map((x) => x.trim()).filter(Boolean);
  return xs.length ? xs : undefined;
}

export type ParsedExportQuery = { ok: true; request: PerformanceRequest } | { ok: false; error: string };

export function parsePerformanceExportQuery(q: Record<string, unknown>): ParsedExportQuery {
  const country = str(q.country) as PerformanceCountry | undefined;
  if (!country || !COUNTRIES.includes(country)) return { ok: false, error: "Country must be Lebanon, Syria, Libya or KSA" };
  const preset = (str(q.preset) ?? "ytd") as PeriodPreset;
  if (!PRESETS.includes(preset)) return { ok: false, error: "Invalid period" };
  const compare = (str(q.compare) ?? "plan") as CompareMode;
  if (!COMPARES.includes(compare)) return { ok: false, error: "Invalid comparison" };
  const anchor = str(q.anchor);
  const from = str(q.from);
  const to = str(q.to);
  for (const [name, v] of [["anchor", anchor], ["from", from], ["to", to]] as const) {
    if (v && !YM.test(v)) return { ok: false, error: `Invalid ${name} month (expected YYYY-MM)` };
  }
  const filters = {
    weights: list(q.weights),
    categories: list(q.categories),
    packaging: list(q.packaging),
    flavours: list(q.flavours),
  };
  const hasFilters = Object.values(filters).some((x) => x && x.length);
  return { ok: true, request: { country, preset, compare, anchor, from, to, filters: hasFilters ? filters : undefined } };
}

/** Mirrors requireCountryAccess in routers.ts: owners see every country, others only their assigned list. */
export async function userMayAccessCountry(username: string | null | undefined, country: PerformanceCountry): Promise<boolean> {
  if (!username) return false;
  const user = await db.getAppUserByUsername(username);
  if (!user) return false;
  if (user.isOwner) return true;
  try {
    const parsed: unknown = JSON.parse(user.countries);
    if (!Array.isArray(parsed)) return false;
    return parsed.some((c) => typeof c === "string" && c.toLowerCase() === country.toLowerCase());
  } catch {
    return false;
  }
}
