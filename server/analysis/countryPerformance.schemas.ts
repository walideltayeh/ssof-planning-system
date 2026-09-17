/** Zod schemas for board-pack data that round-trips through JSON columns / user preferences. */
import { z } from "zod";
import type { BoardHeadline } from "./countryPerformance.types";

const rag = z.enum(["green", "amber", "red", "grey"]);

export const BoardHeadlineSchema: z.ZodType<BoardHeadline> = z.object({
  version: z.literal(1),
  country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
  windowLabel: z.string(),
  year: z.number(),
  asOf: z.string().nullable(),
  generatedAt: z.string(),
  ytdIms: z.number(),
  ytdPlan: z.number().nullable(),
  landing: z.number().nullable(),
  annualPlan: z.number().nullable(),
  remainingForecast: z.number().nullable(),
  runningRate: z.number().nullable(),
  closingStock: z.number(),
  weeksOfCover: z.number().nullable(),
  forecastAccuracyPct: z.number().nullable(),
  stockoutRiskSkus: z.number(),
  overstockSkus: z.number(),
  risks: z.array(z.object({ sku: z.string(), issue: z.string(), severity: rag })),
  skuForecasts: z.array(z.object({ sku: z.string(), weight: z.string(), remainingForecast: z.number() })),
});

export const SlideLayoutSchema = z.object({
  order: z.array(z.string()),
  hidden: z.array(z.string()),
});
export type SlideLayout = z.infer<typeof SlideLayoutSchema>;
