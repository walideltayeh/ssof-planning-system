import { eq } from "drizzle-orm";
import { focData, skus, periods } from "../drizzle/schema";
import type { getDb } from "./db";
import type { Country } from "../drizzle/schema";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function restoreFocOnlySnapshot(db: Db, snapshot: { country: string; foc: typeof focData.$inferSelect[] }, country?: Country) {
  if (!country || snapshot.country !== country || (country !== "Libya" && country !== "Syria") || !Array.isArray(snapshot.foc))
    throw new Error("Invalid country-scoped FOC rollback snapshot");
  const [ss, ps] = await Promise.all([db.select().from(skus).where(eq(skus.country, country)), db.select().from(periods).where(eq(periods.country, country))]);
  if (snapshot.foc.some(r => r.country !== country || !ss.some(s => s.id === r.skuId) || !ps.some(p => p.id === r.periodId)))
    throw new Error("FOC snapshot contains records outside this country's SKU/month scope");
  await db.delete(focData).where(eq(focData.country, country));
  if (snapshot.foc.length) await db.insert(focData).values(snapshot.foc.map(r => ({ ...r, updatedAt: new Date(r.updatedAt ?? Date.now()) })));
}
