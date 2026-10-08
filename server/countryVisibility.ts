import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appSettings, auditTrail, COUNTRIES, type Country } from "../drizzle/schema";
import { getDb, getEffectiveAppRole } from "./db";

const keyFor = (country: Country) => `country.visibility.${country}`;
async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Country availability could not be loaded. Please retry." });
  return db;
}
function hiddenValue(value: string | undefined): boolean {
  if (value === undefined || value === "visible") return false;
  if (value === "hidden") return true;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invalid country availability setting. Please contact an Admin." });
}

/** Read only the four non-secret, allowlisted visibility keys; never expose other app settings. */
export async function hiddenCountries(): Promise<Set<Country>> {
  const db = await database();
  const flags = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings)
    .where(inArray(appSettings.key, COUNTRIES.map(keyFor)));
  const byKey = new Map(flags.map(f => [f.key, f.value]));
  return new Set(COUNTRIES.filter(country => hiddenValue(byKey.get(keyFor(country)))));
}

export async function assertCountryVisible(name: string): Promise<void> {
  const country = COUNTRIES.find(c => c.toLowerCase() === name.toLowerCase());
  if (!country) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown country." });
  if ((await hiddenCountries()).has(country))
    throw new TRPCError({ code: "FORBIDDEN", message: `${country} is hidden and unavailable to everyone. An Admin can restore it from Country Management.` });
}

type CountryAdmin = Parameters<typeof getEffectiveAppRole>[0] & { countries: string };
export function canManageCountry(user: CountryAdmin, country: Country): boolean {
  if (user.isOwner) return true;
  let countries: unknown;
  try { countries = JSON.parse(user.countries); } catch { return false; }
  return Array.isArray(countries) && countries.some(c => typeof c === "string" && c.toLowerCase() === country.toLowerCase())
    && getEffectiveAppRole(user, country) === "admin";
}

/** Caller permission is revalidated separately, without the availability gate, so restoring is always possible. */
export async function setCountryHidden(country: Country, hidden: boolean, actor: string) {
  const db = await database();
  return db.transaction(async tx => {
    const key = keyFor(country);
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
    const wasHidden = hiddenValue(before?.value);
    if (wasHidden === hidden) return { success: true as const, country, isHidden: hidden };
    await tx.insert(appSettings).values({ key, value: hidden ? "hidden" : "visible", updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: hidden ? "hidden" : "visible", updatedAt: new Date() } });
    await tx.insert(auditTrail).values({ country, username: actor, action: "country_visibility", sheet: "Settings",
      field: "Country availability", oldValue: wasHidden ? "Hidden" : "Visible", newValue: hidden ? "Hidden" : "Visible",
      details: JSON.stringify({ country, hidden, note: "Reversible availability change for everyone. All country data and user assignments are preserved." }) });
    return { success: true as const, country, isHidden: hidden };
  }, { isolationLevel: "serializable" });
}
