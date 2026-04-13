import { COOKIE_NAME } from "@shared/const";
import { invokeLLM } from "./_core/llm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ==================== PERIODS ====================
  periods: router({
    list: publicProcedure
      .input(z.object({ country: z.string().optional() }).optional())
      .query(async ({ input }) => {
        await db.ensurePeriods();
        if (input?.country) {
          return db.getPeriodsForCountry(input.country as import('../drizzle/schema').Country);
        }
        return db.getAllPeriods();
      }),
    init: publicProcedure.mutation(async () => {
      return db.ensurePeriods();
    }),
    existingYears: publicProcedure
      .input(z.object({ country: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return db.getExistingYearsForFilter(input?.country as import('../drizzle/schema').Country | undefined);
      }),
    addYear: publicProcedure
      .input(z.object({ year: z.number().min(2024).max(2040), username: z.string().optional() }))
      .mutation(async ({ input }) => {
        const result = await db.addYear(input.year);
        await db.logAudit({
          username: input.username || "System",
          action: "add_year",
          sheet: "Periods",
          details: `Added year ${input.year} with 12 monthly periods`,
        });
        return result;
      }),
  }),

  // ==================== SKUs ====================
  skus: router({
    list: publicProcedure.query(async () => {
      return db.getAllSkus();
    }),
    create: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        weight: z.string(),
        category: z.enum(["Core", "NPI"]).optional(),
        isExcludedFromTotal: z.boolean().optional(),
        username: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.createSku(input);
        await db.logAudit({
          username: input.username || "System",
          action: "add_sku",
          sheet: "SKU",
          skuName: input.name,
          details: `Created SKU: ${input.name} (${input.weight}, ${input.category || "Core"})`,
        });
        return result;
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number(), username: z.string().optional() }))
      .mutation(async ({ input }) => {
        const allSkus = await db.getAllSkus();
        const sku = allSkus.find(s => s.id === input.id);
        await db.deleteSku(input.id);
        await db.logAudit({
          username: input.username || "System",
          action: "delete_sku",
          sheet: "SKU",
          skuName: sku?.name || `ID:${input.id}`,
          details: `Deleted SKU and all associated data`,
        });
        return { success: true };
      }),
    updateCategory: publicProcedure
      .input(z.object({ id: z.number(), category: z.enum(["Core", "NPI"]), username: z.string().optional() }))
      .mutation(async ({ input }) => {
        const allSkus = await db.getAllSkus();
        const sku = allSkus.find(s => s.id === input.id);
        const oldCategory = sku?.category || "unknown";
        await db.updateSkuCategory(input.id, input.category);
        await db.logAudit({
          username: input.username || "System",
          action: "change_category",
          sheet: "SKU",
          skuName: sku?.name || `ID:${input.id}`,
          field: "category",
          oldValue: oldCategory,
          newValue: input.category,
        });
        return { success: true };
      }),
    reorder: publicProcedure
      .input(z.object({ orderedIds: z.array(z.number()), username: z.string().optional() }))
      .mutation(async ({ input }) => {
        await db.reorderLebanonSkus(input.orderedIds);
        await db.logAudit({
          username: input.username || "System",
          action: "reorder_sku",
          sheet: "SKU",
          details: `Reordered ${input.orderedIds.length} Lebanon SKUs`,
        });
        return { success: true };
      }),
  }),

  // ==================== DATA RETRIEVAL ====================
  data: router({
    forecast: publicProcedure.query(async () => {
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getForecastData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    ims: publicProcedure.query(async () => {
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getImsData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    shipment: publicProcedure.query(async () => {
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getShipmentData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    arrival: publicProcedure.query(async () => {
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getArrivalData();
      const shipmentDataAll = await db.getShipmentData();
      return { skus: allSkus, periods: allPeriods, data, shipment: shipmentDataAll };
    }),
    planningFg: publicProcedure
      .input(z.object({ weight: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return db.getFullPlanningData(input?.weight);
      }),
    imsVsForecast: publicProcedure.query(async () => {
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const forecast = await db.getForecastData();
      const ims = await db.getImsData();
      return { skus: allSkus, periods: allPeriods, forecast, ims };
    }),
    uploadHistory: publicProcedure.query(async () => {
      return db.getUploadHistory();
    }),
    exportAll: publicProcedure.query(async () => {
      return db.getFullPlanningData();
    }),
  }),

  // ==================== DATA UPDATE ====================
  update: router({
    forecastCell: publicProcedure
      .input(z.object({ skuId: z.number(), periodId: z.number(), value: z.string(), username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(), oldValue: z.string().optional() }))
      .mutation(async ({ input }) => {
        // Clamp to non-negative
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertForecastData(input.skuId, input.periodId, clampedValue);
        await db.logAudit({
          username: input.username || "System",
          action: "edit_cell",
          sheet: "Forecast",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "value",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Changed from ${input.oldValue || "(empty)"} to ${input.value}`,
        });
        return { success: true };
      }),
    imsCell: publicProcedure
      .input(z.object({ skuId: z.number(), periodId: z.number(), value: z.string(), isActual: z.boolean(), username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(), oldValue: z.string().optional() }))
      .mutation(async ({ input }) => {
        await db.upsertImsData(input.skuId, input.periodId, input.value, input.isActual);
        await db.logAudit({
          username: input.username || "System",
          action: "edit_cell",
          sheet: "IMS",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "value",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Changed from ${input.oldValue || "(empty)"} to ${input.value}`,
        });
        return { success: true };
      }),
    shipmentCell: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string().optional(), week2: z.string().optional(),
        week3: z.string().optional(), week4: z.string().optional(),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldWeek1: z.string().optional(), oldWeek2: z.string().optional(),
        oldWeek3: z.string().optional(), oldWeek4: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { skuId, periodId, username, skuName, periodLabel, oldWeek1, oldWeek2, oldWeek3, oldWeek4, ...weeks } = input;
        await db.upsertShipmentData(skuId, periodId, weeks);
        const changes: string[] = [];
        if (weeks.week1 !== undefined) changes.push(`W1: ${oldWeek1 || "0"} → ${weeks.week1}`);
        if (weeks.week2 !== undefined) changes.push(`W2: ${oldWeek2 || "0"} → ${weeks.week2}`);
        if (weeks.week3 !== undefined) changes.push(`W3: ${oldWeek3 || "0"} → ${weeks.week3}`);
        if (weeks.week4 !== undefined) changes.push(`W4: ${oldWeek4 || "0"} → ${weeks.week4}`);
        await db.logAudit({
          username: username || "System",
          action: "edit_cell",
          sheet: "Shipment",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    arrivalCell: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string().optional(), week2: z.string().optional(),
        week3: z.string().optional(), week4: z.string().optional(),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldWeek1: z.string().optional(), oldWeek2: z.string().optional(),
        oldWeek3: z.string().optional(), oldWeek4: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { skuId, periodId, username, skuName, periodLabel, oldWeek1, oldWeek2, oldWeek3, oldWeek4, ...weeks } = input;
        await db.upsertArrivalData(skuId, periodId, weeks);
        const changes: string[] = [];
        if (weeks.week1 !== undefined) changes.push(`W1: ${oldWeek1 || "0"} → ${weeks.week1}`);
        if (weeks.week2 !== undefined) changes.push(`W2: ${oldWeek2 || "0"} → ${weeks.week2}`);
        if (weeks.week3 !== undefined) changes.push(`W3: ${oldWeek3 || "0"} → ${weeks.week3}`);
        if (weeks.week4 !== undefined) changes.push(`W4: ${oldWeek4 || "0"} → ${weeks.week4}`);
        await db.logAudit({
          username: username || "System",
          action: "edit_cell",
          sheet: "Arrival",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    syncImsAndForecast: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
        source: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Clamp to non-negative
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        // Update both IMS and Forecast tables to keep them in sync (two-way)
        await db.upsertImsData(input.skuId, input.periodId, clampedValue, false);
        await db.upsertForecastData(input.skuId, input.periodId, clampedValue);
        await db.logAudit({
          username: input.username || "System",
          action: "edit_cell",
          sheet: input.source || "Planning FG (IMS sync)",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "IMS + Forecast",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Synced IMS and Forecast: ${input.oldValue || "(empty)"} → ${input.value}`,
        });
        return { success: true };
      }),
    applyRecommendation: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), newForecast: z.string(), oldForecast: z.string(),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), source: z.string().optional(),
        title: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Only update the Forecast table — do NOT touch IMS (actual sales)
        await db.upsertForecastData(input.skuId, input.periodId, input.newForecast);
        await db.logAudit({
          username: input.username || "System",
          action: "apply_recommendation",
          sheet: input.source || "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Forecast",
          oldValue: input.oldForecast,
          newValue: input.newForecast,
          details: `Applied recommendation: ${input.title || ""} | Forecast: ${input.oldForecast} → ${input.newForecast}`,
        });
        return { success: true };
      }),
    rollbackRecommendation: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), oldForecast: z.string(), appliedForecast: z.string(),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), source: z.string().optional(),
        title: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Rollback: restore the original Forecast value
        await db.upsertForecastData(input.skuId, input.periodId, input.oldForecast);
        await db.logAudit({
          username: input.username || "System",
          action: "rollback_recommendation",
          sheet: input.source || "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Forecast",
          oldValue: input.appliedForecast,
          newValue: input.oldForecast,
          details: `Rolled back recommendation: ${input.title || ""} | Forecast restored: ${input.appliedForecast} → ${input.oldForecast}`,
        });
        return { success: true };
      }),
    invoicedSHP: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.number().default(0), week2: z.number().default(0),
        week3: z.number().default(0), week4: z.number().default(0),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { skuId, periodId, username, skuName, periodLabel, week1, week2, week3, week4 } = input;
        // 1. Save shipment weekly data
        await db.upsertShipmentData(skuId, periodId, {
          week1: String(week1), week2: String(week2), week3: String(week3), week4: String(week4),
        });
        // 2. Update planningFgData.invoiced with the monthly total
        const invoicedTotal = week1 + week2 + week3 + week4;
        await db.upsertPlanningFgData(skuId, periodId, { invoiced: String(invoicedTotal) });
        // 3. Compute arrivals +2 weeks: W1→W3(same), W2→W4(same), W3→W1(next), W4→W2(next)
        // Get Lebanon periods sorted by sortOrder to find next period
        const allPeriods = await db.getPeriodsForCountry('Lebanon');
        const currentPeriodIdx = allPeriods.findIndex(p => p.id === periodId);
        const nextPeriod = currentPeriodIdx >= 0 && currentPeriodIdx < allPeriods.length - 1
          ? allPeriods[currentPeriodIdx + 1] : null;
        // Same-period arrivals: W1 ships → W3 arrives, W2 ships → W4 arrives
        const sameMonthArrival = { week3: String(week1), week4: String(week2) };
        // Next-period arrivals: W3 ships → W1 arrives, W4 ships → W2 arrives
        const nextMonthArrival = nextPeriod
          ? { week1: String(week3), week2: String(week4) } : null;
        // Fetch existing arrival data for same period to preserve W1/W2
        await db.upsertArrivalData(skuId, periodId, sameMonthArrival);
        if (nextPeriod && nextMonthArrival) {
          await db.upsertArrivalData(skuId, nextPeriod.id, nextMonthArrival);
        }
        // 4. Recompute planningFgData.arrivals monthly totals from arrivalData
        const arrivalRows = await db.getArrivalData();
        const sameArrRow = arrivalRows.find(r => r.skuId === skuId && r.periodId === periodId);
        if (sameArrRow) {
          const sameTotal = (parseFloat(sameArrRow.week1 || '0') + parseFloat(sameArrRow.week2 || '0') +
            parseFloat(sameArrRow.week3 || '0') + parseFloat(sameArrRow.week4 || '0'));
          await db.upsertPlanningFgData(skuId, periodId, { arrivals: String(sameTotal) });
        }
        if (nextPeriod) {
          const nextArrRow = arrivalRows.find(r => r.skuId === skuId && r.periodId === nextPeriod.id);
          if (nextArrRow) {
            const nextTotal = (parseFloat(nextArrRow.week1 || '0') + parseFloat(nextArrRow.week2 || '0') +
              parseFloat(nextArrRow.week3 || '0') + parseFloat(nextArrRow.week4 || '0'));
            await db.upsertPlanningFgData(skuId, nextPeriod.id, { arrivals: String(nextTotal) });
          }
        }
        await db.logAudit({
          username: username || 'System',
          action: 'edit_cell',
          sheet: 'Planning FG (Invoiced SHP)',
          skuName,
          periodLabel,
          field: 'Invoiced (SHP) W1-W4',
          oldValue: '',
          newValue: `W1=${week1}, W2=${week2}, W3=${week3}, W4=${week4} (Total=${invoicedTotal})`,
          details: `Shipment entered: W1=${week1}→arrives W3 same month, W2=${week2}→arrives W4 same month, W3=${week3}→arrives W1 next month, W4=${week4}→arrives W2 next month`,
        });
        return { success: true, invoicedTotal, nextPeriodId: nextPeriod?.id };
      }),
    planningFgCell: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        openingStock: z.string().optional(), adjustments: z.string().optional(),
        invoiced: z.string().optional(), arrivals: z.string().optional(),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldOpeningStock: z.string().optional(), oldAdjustments: z.string().optional(),
        oldInvoiced: z.string().optional(), oldArrivals: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { skuId, periodId, username, skuName, periodLabel, oldOpeningStock, oldAdjustments, oldInvoiced, oldArrivals, ...data } = input;
        await db.upsertPlanningFgData(skuId, periodId, data);
        const changes: string[] = [];
        if (data.openingStock !== undefined) changes.push(`Opening Stock: ${oldOpeningStock || "0"} → ${data.openingStock}`);
        if (data.adjustments !== undefined) changes.push(`Adjustments: ${oldAdjustments || "0"} → ${data.adjustments}`);
        if (data.invoiced !== undefined) changes.push(`Invoiced: ${oldInvoiced || "0"} → ${data.invoiced}`);
        if (data.arrivals !== undefined) changes.push(`Arrivals: ${oldArrivals || "0"} → ${data.arrivals}`);
        await db.logAudit({
          username: username || "System",
          action: "edit_cell",
          sheet: "Planning FG",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    // Sync Planning FG arrival to arrivalData source table
    syncPlanningFgArrival: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertPlanningFgData(input.skuId, input.periodId, { arrivals: clampedValue });
        await db.upsertArrivalData(input.skuId, input.periodId, { week1: clampedValue, week2: "0", week3: "0", week4: "0" });
        await db.logAudit({
          username: input.username || "System",
          action: "edit_cell",
          sheet: "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Actual arrivals / Planned Orders",
          oldValue: input.oldValue || "0",
          newValue: clampedValue,
          details: `Planning FG arrival synced to source: ${input.oldValue || "0"} → ${clampedValue}`,
        });
        return { success: true };
      }),
    // Auto-fill IMS from Forecast for a given period
    autoFillImsFromForecast: publicProcedure
      .input(z.object({
        periodId: z.number(),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const skus = await db.getSkusForCountry(country);
        const forecastData = await db.getForecastDataForCountry(country);
        const imsDataArr = await db.getImsDataForCountry(country);

        // Build maps
        const forecastMap = new Map<string, string>();
        for (const f of forecastData) forecastMap.set(`${f.skuId}-${f.periodId}`, f.value ?? "0");
        const imsMapExisting = new Map<string, { value: string; isActual: boolean }>();
        for (const i of imsDataArr) imsMapExisting.set(`${i.skuId}-${i.periodId}`, { value: i.value ?? "0", isActual: i.isActual ?? false });

        let filled = 0;
        for (const sku of skus) {
          const key = `${sku.id}-${input.periodId}`;
          const forecastVal = forecastMap.get(key) ?? "0";
          const fNum = parseFloat(forecastVal) || 0;
          if (fNum === 0) continue; // skip if no forecast

          // Overwrite IMS with forecast value
          await db.upsertImsData(sku.id, input.periodId, forecastVal, false);
          filled++;
        }

        await db.logAudit({
          country, username: input.username || "System",
          action: "auto_fill", sheet: "IMS",
          details: `Auto-filled ${filled} IMS cells from Forecast for period ${input.periodId}`,
        });

        return { success: true, filled };
      }),
  }),

  // ==================== BULK UPLOAD ====================
  upload: router({
    forecast: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            value: z.string(),
          })),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        let periodsRefreshed = await db.getPeriodsForCountry(country);
        if (periodsRefreshed.length === 0) { await db.ensurePeriods(); periodsRefreshed = await db.getPeriodsForCountry(country); }
        let allSkus = await db.getSkusForCountry(country, true);
        
        const bulkRecords: { skuId: number; periodId: number; value: string }[] = [];
        for (const rec of input.records) {
          let sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) {
            const result = await db.createSkuForCountry(country, { name: rec.skuName, weight: rec.weight });
            allSkus = await db.getSkusForCountry(country, true);
            sku = allSkus.find(s => s.id === result.id);
          }
          if (!sku) continue;
          
          for (const val of rec.values) {
            const period = periodsRefreshed.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              bulkRecords.push({ skuId: sku.id, periodId: period.id, value: val.value });
            }
          }
        }
        await db.bulkUpsertForecast(bulkRecords);
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "Forecast",
          details: `Uploaded ${bulkRecords.length} forecast records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    imsActuals: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            value: z.string(),
            isActual: z.boolean(),
          })),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              bulkRecords.push({ skuId: sku.id, periodId: period.id, value: val.value, isActual: val.isActual });
            }
          }
        }
        await db.bulkUpsertIms(bulkRecords);
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "IMS Actuals",
          details: `Uploaded ${bulkRecords.length} IMS records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    openingStock: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          value: z.string(),
          periodYear: z.number(),
          periodMonth: z.number(),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        let processed = 0;
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          const period = allPeriods.find(p => p.year === rec.periodYear && p.month === rec.periodMonth);
          if (sku && period) {
            await db.upsertPlanningFgData(sku.id, period.id, { openingStock: rec.value });
            processed++;
          }
        }
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "Opening Stock",
          details: `Uploaded ${processed} opening stock records`,
        });
        return { success: true, processed };
      }),

    shipment: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            week1: z.string().optional().default("0"),
            week2: z.string().optional().default("0"),
            week3: z.string().optional().default("0"),
            week4: z.string().optional().default("0"),
            value: z.string().optional(), // Lebanon monthly total
          })),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              const week1 = val.value !== undefined ? val.value : (val.week1 ?? "0");
              const week2 = val.value !== undefined ? "0" : (val.week2 ?? "0");
              const week3 = val.value !== undefined ? "0" : (val.week3 ?? "0");
              const week4 = val.value !== undefined ? "0" : (val.week4 ?? "0");
              bulkRecords.push({ skuId: sku.id, periodId: period.id, week1, week2, week3, week4 });
            }
          }
        }
        await db.bulkUpsertShipment(bulkRecords);
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "Shipment",
          details: `Uploaded ${bulkRecords.length} shipment records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    arrival: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            week1: z.string().optional().default("0"),
            week2: z.string().optional().default("0"),
            week3: z.string().optional().default("0"),
            week4: z.string().optional().default("0"),
            value: z.string().optional(), // Lebanon monthly total
          })),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              const week1 = val.value !== undefined ? val.value : (val.week1 ?? "0");
              const week2 = val.value !== undefined ? "0" : (val.week2 ?? "0");
              const week3 = val.value !== undefined ? "0" : (val.week3 ?? "0");
              const week4 = val.value !== undefined ? "0" : (val.week4 ?? "0");
              bulkRecords.push({ skuId: sku.id, periodId: period.id, week1, week2, week3, week4 });
            }
          }
        }
        await db.bulkUpsertArrival(bulkRecords);
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "Arrival",
          details: `Uploaded ${bulkRecords.length} arrival records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    planningFgBulk: publicProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            openingStock: z.string(),
            adjustments: z.string(),
            invoiced: z.string().optional(),
            arrivals: z.string().optional(),
            ims: z.string().optional(), // IMS from Planning FG sheet
          })),
        })),
        username: z.string().optional(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        let periodsRefreshed = await db.getPeriodsForCountry(country);
        if (periodsRefreshed.length === 0) { await db.ensurePeriods(); periodsRefreshed = await db.getPeriodsForCountry(country); }
        let allSkus = await db.getSkusForCountry(country, true);
        const pfgRecords: { skuId: number; periodId: number; openingStock?: string; adjustments?: string; invoiced?: string; arrivals?: string }[] = [];
        const imsRecords: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
        const now = new Date();
        for (const rec of input.records) {
          let sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = periodsRefreshed.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              pfgRecords.push({
                skuId: sku.id, periodId: period.id,
                openingStock: val.openingStock, adjustments: val.adjustments,
                invoiced: val.invoiced || "0", arrivals: val.arrivals || "0",
              });
              if (val.ims !== undefined) {
                const imsNum = parseFloat(val.ims) || 0;
                const isActual = val.year < now.getFullYear() || (val.year === now.getFullYear() && val.month <= now.getMonth() + 1);
                imsRecords.push({ skuId: sku.id, periodId: period.id, value: imsNum.toString(), isActual });
              }
            }
          }
        }
        await db.bulkUpsertPlanningFg(pfgRecords);
        if (imsRecords.length > 0) await db.bulkUpsertIms(imsRecords);
        await db.logAudit({
          username: input.username || "System",
          action: "upload",
          sheet: "Planning FG",
          details: `Uploaded ${pfgRecords.length} planning FG records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: pfgRecords.length };
      }),
  }),

  // ==================== AUDIT TRAIL ====================
  audit: router({
    logs: publicProcedure
      .input(z.object({
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
        username: z.string().optional(),
        action: z.string().optional(),
        sheet: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getAuditLogs(input || {});
      }),
    logAction: publicProcedure
      .input(z.object({
        username: z.string(),
        action: z.string(),
        sheet: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
        field: z.string().optional(),
        oldValue: z.string().optional(),
        newValue: z.string().optional(),
        details: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.logAudit(input);
        return { success: true };
      }),
  }),

  // ==================== SSOF VERSIONS ====================
  versions: router({
    list: publicProcedure
      .input(z.object({ country: z.enum(['Lebanon', 'Syria', 'Libya']).optional() }).optional())
      .query(async ({ input }) => {
        return db.listVersions(input?.country as any);
      }),

    save: publicProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        username: z.string(),
        country: z.enum(['Lebanon', 'Syria', 'Libya']).optional(),
      }))
      .mutation(async ({ input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        // 1. Take country-scoped snapshot of current data
        const snapshot = await db.getFullSnapshot(country);

        // 2. Build changes summary from audit trail (since last version or all)
        const versions = await db.listVersions(country);
        const lastVersion = versions.length > 0 ? versions[0] : null;
        const auditResult = await db.getAuditLogs({ limit: 500 });
        const allLogs = auditResult.logs;
        const changesSince = lastVersion
          ? allLogs.filter(l => l.createdAt > lastVersion.createdAt)
          : allLogs;

        const changesSummary = {
          totalChanges: changesSince.length,
          bySheet: {} as Record<string, number>,
          byAction: {} as Record<string, number>,
          byUser: {} as Record<string, number>,
          recentChanges: changesSince.slice(0, 100).map(l => ({
            username: l.username,
            action: l.action,
            sheet: l.sheet,
            skuName: l.skuName,
            periodLabel: l.periodLabel,
            field: l.field,
            oldValue: l.oldValue,
            newValue: l.newValue,
            details: l.details,
            createdAt: l.createdAt,
          })),
          previousVersion: lastVersion ? lastVersion.name : null,
          skuCount: snapshot.skus.length,
          periodCount: snapshot.periods.length,
        };
        for (const log of changesSince) {
          if (log.sheet) changesSummary.bySheet[log.sheet] = (changesSummary.bySheet[log.sheet] || 0) + 1;
          changesSummary.byAction[log.action] = (changesSummary.byAction[log.action] || 0) + 1;
          changesSummary.byUser[log.username] = (changesSummary.byUser[log.username] || 0) + 1;
        }

        // 3. Generate Word document
        let docUrl: string | undefined;
        try {
          const { generateVersionDoc } = await import('./versionDoc');
          docUrl = await generateVersionDoc(input.name, input.description, changesSummary, snapshot);
        } catch (err) {
          console.error('[Version] Failed to generate Word doc:', err);
        }

        // 4. Save version
        const result = await db.saveVersion({
          name: input.name,
          description: input.description,
          savedBy: input.username,
          snapshotData: snapshot,
          changesSummary,
          docUrl,
          country,
        });

        await db.logAudit({
          country,
          username: input.username,
          action: 'save_version',
          sheet: 'SSOF Version',
          details: `Saved version "${input.name}" for ${country}${input.description ? ': ' + input.description : ''}`,
        });

        return { success: true, id: result.id, docUrl };
      }),

    load: publicProcedure
      .input(z.object({ id: z.number(), username: z.string() }))
      .mutation(async ({ input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        await db.restoreSnapshot(version.snapshotData, version.country as any);
        await db.logAudit({
          country: version.country as any,
          username: input.username,
          action: 'load_version',
          sheet: 'SSOF Version',
          details: `Loaded version "${version.name}" (ID: ${version.id}) for ${version.country}`,
        });
        return { success: true, name: version.name };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number(), username: z.string() }))
      .mutation(async ({ input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        await db.deleteVersion(input.id);
        await db.logAudit({
          username: input.username,
          action: 'delete_version',
          sheet: 'SSOF Version',
          details: `Deleted version "${version.name}" (ID: ${version.id})`,
        });
        return { success: true };
      }),

    export: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        return {
          name: version.name,
          description: version.description,
          savedBy: version.savedBy,
          createdAt: version.createdAt,
          snapshotData: version.snapshotData,
          changesSummary: version.changesSummary,
        };
      }),

    import: publicProcedure
      .input(z.object({
        versionData: z.any(), // The full version JSON from file
        username: z.string(),
        country: z.enum(['Lebanon', 'Syria', 'Libya']).optional(),
      }))
      .mutation(async ({ input }) => {
        const { versionData, username } = input;
        const country = (input.country || versionData.country || 'Lebanon') as import('../drizzle/schema').Country;
        if (!versionData.snapshotData) throw new Error('Invalid version file: missing snapshot data');
        await db.restoreSnapshot(versionData.snapshotData, country);
        await db.logAudit({
          country,
          username,
          action: 'import_version',
          sheet: 'SSOF Version',
          details: `Imported version "${versionData.name || 'Unknown'}" from local file for ${country}`,
        });
        return { success: true, name: versionData.name || 'Imported Version' };
      }),

    // ---- Version Comparison ----
    compare: publicProcedure
      .input(z.object({ versionAId: z.number(), versionBId: z.number() }))
      .query(async ({ input }) => {
        const vA = await db.getVersionById(input.versionAId);
        const vB = await db.getVersionById(input.versionBId);
        if (!vA || !vB) throw new Error('One or both versions not found');
        return {
          versionA: { id: vA.id, name: vA.name, savedBy: vA.savedBy, createdAt: vA.createdAt, snapshot: vA.snapshotData },
          versionB: { id: vB.id, name: vB.name, savedBy: vB.savedBy, createdAt: vB.createdAt, snapshot: vB.snapshotData },
        };
      }),

    // ---- Version Comments ----
    comments: publicProcedure
      .input(z.object({ versionId: z.number() }))
      .query(async ({ input }) => {
        return db.getVersionComments(input.versionId);
      }),

    addComment: publicProcedure
      .input(z.object({ versionId: z.number(), username: z.string(), comment: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const result = await db.addVersionComment(input);
        return { success: true, id: result.id };
      }),

    deleteComment: publicProcedure
      .input(z.object({ id: z.number(), username: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteVersionComment(input.id);
        return { success: true };
      }),

    // ---- Edit Count (for auto-save reminders) ----
    editCount: publicProcedure
      .input(z.object({ country: z.string().optional() }))
      .query(async ({ input }) => {
        return { count: await db.getEditCountSinceVersion(input.country) };
      }),
  }),

  // ==================== ANALYSIS ====================
  analysis: router({
    overview: publicProcedure.query(async () => {
      return db.getAnalysisOverview();
    }),
    bySku: publicProcedure.query(async () => {
      return db.getAnalysisBySku();
    }),
    byWeight: publicProcedure.query(async () => {
      return db.getAnalysisByWeight();
    }),
    byCategory: publicProcedure.query(async () => {
      return db.getAnalysisByCategory();
    }),
    byFlavor: publicProcedure.query(async () => {
      return db.getAnalysisByFlavor();
    }),
    production: publicProcedure.query(async () => {
      return db.getAnalysisProduction();
    }),
    stockHealth: publicProcedure.query(async () => {
      return db.getAnalysisStockHealth();
    }),
     stockSnapshot: publicProcedure.query(async () => {
      return db.getStockSnapshot();
    }),
  }),
  // ==================== COUNTRY-SCOPED DATA ====================
  country: router({
    // Initialize a country's periods
    init: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .mutation(async ({ input }) => {
        await db.ensurePeriodsForCountry(input.country);
        return { success: true };
      }),
    // Fetch all data for a country
    data: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        const c = input.country;
        await db.ensurePeriodsForCountry(c);
        const [countrySkus, countryPeriods, forecast, revisedForecast, ims, shipment, arrival] = await Promise.all([
          db.getSkusForCountry(c),
          db.getPeriodsForCountry(c),
          db.getForecastDataForCountry(c),
          db.getRevisedForecastDataForCountry(c),
          db.getImsDataForCountry(c),
          db.getShipmentDataForCountry(c),
          db.getArrivalDataForCountry(c),
        ]);
        return { skus: countrySkus, periods: countryPeriods, forecast, revisedForecast, ims, shipment, arrival };
      }),
    // Get SKUs for a country
    skus: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]), includeInactive: z.boolean().optional() }))
      .query(async ({ input }) => {
        return db.getSkusForCountry(input.country, input.includeInactive ?? false);
      }),
    // Create SKU for a country
    createSku: publicProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        name: z.string().min(1),
        weight: z.string(),
        category: z.enum(["Core", "NPI"]).optional(),
        packagingType: z.enum(["Old", "New"]).optional(),
        isExcludedFromTotal: z.boolean().optional(),
        username: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.createSkuForCountry(input.country, {
          name: input.name,
          weight: input.weight,
          category: input.category,
          packagingType: input.packagingType,
          isExcludedFromTotal: input.isExcludedFromTotal,
        });
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "create_sku",
          sheet: "SKU Management",
          skuName: input.name,
          details: `Created SKU: ${input.name} (${input.weight}) for ${input.country}`,
        });
        return result;
      }),
    // Update SKU packaging type
    updateSkuPackaging: publicProcedure
      .input(z.object({
        skuId: z.number(),
        packagingType: z.enum(["Old", "New"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateSkuPackagingType(input.skuId, input.packagingType);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "update_sku",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `Updated packaging type to ${input.packagingType}`,
          newValue: input.packagingType,
        });
        return { success: true };
      }),
    // Delete SKU
    deleteSku: publicProcedure
      .input(z.object({
        skuId: z.number(),
        username: z.string().optional(),
        skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.deleteSku(input.skuId);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "delete_sku",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `Deleted SKU: ${input.skuName || input.skuId}`,
        });
        return { success: true };
      }),
    // Toggle SKU active/inactive
    toggleSkuActive: publicProcedure
      .input(z.object({
        skuId: z.number(),
        isActive: z.boolean(),
        username: z.string().optional(),
        skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.toggleSkuActive(input.skuId, input.isActive);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `SKU ${input.isActive ? "enabled" : "disabled"}: ${input.skuName || input.skuId}`,
        });
        return { success: true };
      }),
    // Update forecast cell
    updateForecast: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        targetWeek: z.string().optional(), // "week1" | "week2" | "week3" | "week4"
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const clamped = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertForecastData(input.skuId, input.periodId, clamped, input.targetWeek);
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "edit", sheet: "Forecast Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          oldValue: input.oldValue || "", newValue: clamped,
          details: `Changed from ${input.oldValue || "(empty)"} to ${clamped}`,
        });
        return { success: true };
      }),
    // Update only the targetWeek for a forecast cell (without changing the value)
    updateForecastWeek: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        targetWeek: z.string(), // "week1" | "week2" | "week3" | "week4"
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertForecastData(input.skuId, input.periodId, undefined as any, input.targetWeek);
        // Also update production to reflect the new week assignment
        const existing = await db.getForecastCellValue(input.skuId, input.periodId);
        if (existing && (input.country === "Syria" || input.country === "Libya")) {
          const val = existing.value ?? "0";
          const weeks = { week1: "0", week2: "0", week3: "0", week4: "0", [input.targetWeek]: val };
          await db.upsertShipmentData(input.skuId, input.periodId, { week1: weeks.week1, week2: weeks.week2, week3: weeks.week3, week4: weeks.week4 });
        }
        return { success: true };
      }),
    // Update revised forecast cell (Syria/Libya Forecast vs Forecast)
    updateRevisedForecast: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(), skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const clamped = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertRevisedForecastData(input.skuId, input.periodId, clamped);
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "edit", sheet: "Revised Forecast",
          skuName: input.skuName, periodLabel: input.periodLabel,
          oldValue: input.oldValue || "", newValue: clamped,
          details: `Revised forecast changed from ${input.oldValue || "(empty)"} to ${clamped}`,
        });
        return { success: true };
      }),
    // Update production (shipment) cell
    updateProduction: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string(), week2: z.string(), week3: z.string(), week4: z.string(),
        arrivalOffsetValue: z.number().optional(),
        arrivalOffsetUnit: z.enum(["days", "weeks", "months"]).optional(),
        note: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertShipmentData(input.skuId, input.periodId, {
          week1: input.week1, week2: input.week2, week3: input.week3, week4: input.week4,
          arrivalOffsetValue: input.arrivalOffsetValue,
          arrivalOffsetUnit: input.arrivalOffsetUnit,
          note: input.note,
          invoiceRef: input.invoiceRef,
          containerRef: input.containerRef,
        });
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "edit", sheet: "Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated production weeks`,
        });
        return { success: true };
      }),
    updateProductionRefs: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertShipmentData(input.skuId, input.periodId, {
          invoiceRef: input.invoiceRef,
          containerRef: input.containerRef,
        });
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "edit", sheet: "Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated refs — Invoice: ${input.invoiceRef ?? ""}, Container: ${input.containerRef ?? ""}`,
        });
        return { success: true };
      }),
    // Update arrival cell
    updateArrival: publicProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string(), week2: z.string(), week3: z.string(), week4: z.string(),
        arrivalOffsetWeeks: z.number().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(), skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertArrivalData(input.skuId, input.periodId, {
          week1: input.week1, week2: input.week2, week3: input.week3, week4: input.week4,
        });
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "edit", sheet: "Arrival",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated arrival data`,
        });
        return { success: true };
      }),
    // Add year for a country
    addYear: publicProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        year: z.number().min(2024).max(2040),
        username: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.addYearForCountry(input.country, input.year);
        await db.logAudit({
          country: input.country, username: input.username || "System",
          action: "add_year", sheet: "Periods",
          details: `Added year ${input.year} for ${input.country}`,
        });
        return result;
      }),
    // Get existing years for a country
    existingYears: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getExistingYearsForCountry(input.country);
      }),
    // Update SKU details (name, weight, category, packagingType)
    updateSku: publicProcedure
      .input(z.object({
        skuId: z.number(),
        name: z.string().min(1).optional(),
        weight: z.string().optional(),
        category: z.enum(["Core", "NPI"]).optional(),
        packagingType: z.enum(["Old", "New"]).optional(),
        username: z.string().optional(),
        skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya"]).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateSkuDetails(input.skuId, {
          name: input.name,
          weight: input.weight,
          category: input.category,
          packagingType: input.packagingType,
        });
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "update_sku",
          sheet: "SKU Management",
          skuName: input.skuName || input.name,
          details: `Updated SKU details`,
        });
        return { success: true };
      }),
    // Update arrival status for a production batch (Syria/Libya)
    updateArrivalStatus: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        status: z.enum(["Pending", "In Transit", "Arrived", "Delayed", "Cleared", "Partially Cleared"]),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateShipmentArrivalStatus(input.skuId, input.periodId, input.status);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Arrival status changed to ${input.status}`,
        });
        return { success: true };
      }),

    // Update cleared qty for a production batch (Syria/Libya) - supports partial clearance
    updateClearedQty: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        clearedQty: z.number().nullable(),
        totalQty: z.number(), // full production qty to determine auto-status
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.updateShipmentClearedQty(
          input.skuId,
          input.periodId,
          input.clearedQty,
          input.totalQty
        );
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.clearedQty !== null
            ? `Cleared qty set to ${input.clearedQty} of ${input.totalQty} (${result?.autoStatus ?? "status unchanged"})`
            : `Cleared qty removed`,
        });
        return { success: true, autoStatus: result?.autoStatus };
      }),

    // Update cleared date for a production batch (Syria/Libya)
    updateClearedDate: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        clearedDate: z.string().nullable(), // ISO date string YYYY-MM-DD or null
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateShipmentClearedDate(input.skuId, input.periodId, input.clearedDate);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.clearedDate
            ? `Cleared date set to ${input.clearedDate}`
            : `Cleared date removed`,
        });
        return { success: true };
      }),

    // Update pending clear date for a production batch (Syria/Libya)
    updatePendingClearDate: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        pendingClearDate: z.string().nullable(), // ISO date string YYYY-MM-DD or null
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateShipmentPendingClearDate(input.skuId, input.periodId, input.pendingClearDate);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.pendingClearDate
            ? `Pending clear date set to ${input.pendingClearDate}`
            : `Pending clear date removed`,
        });
        return { success: true };
      }),

    // List all clearance events for a country
    clearanceEvents: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getClearanceEventsForCountry(input.country);
      }),

    // Add a new clearance event for a batch
    addClearanceEvent: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        clearedQty: z.string(),
        clearedDate: z.string(), // YYYY-MM-DD
        pendingClearDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.addClearanceEvent(input);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Clearance event added: ${input.clearedQty} units on ${input.clearedDate}`,
        });
        return { id };
      }),

    // Update an existing clearance event
    updateClearanceEvent: publicProcedure
      .input(z.object({
        eventId: z.number(),
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        clearedQty: z.string().optional(),
        clearedDate: z.string().optional(),
        pendingClearDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { eventId, username, skuName, periodLabel, ...rest } = input;
        await db.updateClearanceEvent(eventId, rest);
        await db.logAudit({
          country: input.country,
          username: username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName,
          periodLabel,
          details: `Clearance event ${eventId} updated`,
        });
        return { success: true };
      }),

    // Delete a clearance event
    deleteClearanceEvent: publicProcedure
      .input(z.object({
        eventId: z.number(),
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.deleteClearanceEvent(input.eventId, input.skuId, input.periodId, input.country);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Clearance event ${input.eventId} deleted`,
        });
        return { success: true };
      }),

    planningFg: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getFullPlanningDataForCountry(input.country as "Syria" | "Libya");
      }),

    // Update IMS cell for Syria/Libya
    updateIms: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertImsData(input.skuId, input.periodId, input.value, true);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit_cell",
          sheet: "IMS",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "IMS",
          newValue: input.value,
        });
        return { success: true };
      }),

    // Intl Analysis query for Syria/Libya
    intlAnalysis: publicProcedure
      .input(z.object({ country: z.enum(["Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getIntlAnalysis(input.country);
      }),

    runningRate: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getRunningRateAnalysis(input.country);
      }),

    stockLevels: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getStockLevelAnalysis(input.country);
      }),

    forecastIntelligence: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getForecastIntelligence(input.country);
      }),

    currentMonthClosingStock: publicProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getCurrentMonthClosingStock(input.country);
      }),

    competitorData: publicProcedure
      .input(z.object({ country: z.string() }))
      .query(async ({ input }) => {
        const data = await db.getCompetitorData(input.country);
        if (!data) return null;
        return {
          brandMonthly: data.brandMonthly,
          brandMonthlyKg: data.brandMonthlyKg,
          flavorYearly: data.flavorYearly,
          flavorYearlyKg: data.flavorYearlyKg,
          uploadedBy: data.uploadedBy,
          uploadedAt: data.uploadedAt?.toISOString() ?? null,
        };
      }),

    updatePlanningFgCell: publicProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        label: z.string(),
        value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya"]),
        username: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
        oldValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const fieldMap: Record<string, string> = {
          "Opening Stock": "openingStock",
          "Adjustments": "adjustments",
          "Invoiced (SHP)": "invoiced",
          "Actual arrivals / Planned Orders": "arrivals",
        };
        const field = fieldMap[input.label];
        if (!field) throw new Error(`Unknown label: ${input.label}`);
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertCountryPlanningFgCell(input.skuId, input.periodId, { [field]: clampedValue });
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "edit_cell",
          sheet: "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: input.label,
          oldValue: input.oldValue,
          newValue: clampedValue,
        });
        return { success: true };
      }),

    // Product Expiry Dashboard
    expiryDashboard: publicProcedure
      .input(z.object({ country: z.enum(["Syria", "Libya"]) }))
      .query(async ({ input }) => {
        return db.getExpiryDashboard(input.country);
      }),

    reorderSkus: publicProcedure
      .input(z.object({
        country: z.enum(["Syria", "Libya"]),
        orderedIds: z.array(z.number()),
        username: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.reorderCountrySkus(input.country, input.orderedIds);
        await db.logAudit({
          country: input.country,
          username: input.username || "System",
          action: "reorder_sku",
          sheet: "SKU",
          details: `Reordered ${input.orderedIds.length} ${input.country} SKUs`,
        });
        return { success: true };
      }),
  }),
  appUsers: router({
    // Verify login from any device - returns user info on success
    verifyLogin: publicProcedure
      .input(z.object({
        username: z.string(),
        password: z.string(),
        country: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.ensureOwnerExists("walid", "Walid El Tayeh");
        if (input.country) {
          const result = await db.verifyAppUserLogin(input.username, input.password, input.country);
          if (!result.success || !result.user) {
            return { success: false, error: result.error ?? "Invalid credentials" };
          }
          const u = result.user;
          return {
            success: true,
            user: {
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              role: u.role,
              countries: JSON.parse(u.countries) as string[],
              isOwner: u.isOwner,
            },
          };
        }
        const result = await db.verifyAppUserLoginNoCountry(input.username, input.password);
        if (!result.success || !result.user) {
          return { success: false, error: result.error ?? "Invalid credentials" };
        }
        const u = result.user;
        return {
          success: true,
          user: {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            role: u.role,
            countries: JSON.parse(u.countries) as string[],
            isOwner: u.isOwner,
          },
        };
      }),
    // Change own password - any authenticated user
    changePassword: publicProcedure
      .input(z.object({
        userId: z.number(),
        currentPassword: z.string(),
        newPassword: z.string().min(1),
        confirmPassword: z.string(),
      }))
      .mutation(async ({ input }) => {
        if (input.newPassword !== input.confirmPassword) {
          return { success: false, error: "New passwords do not match" };
        }
        const result = await db.changeAppUserPassword(input.userId, input.currentPassword, input.newPassword);
        return result;
      }),
    // List all users - owner only
    list: publicProcedure
      .input(z.object({ requestingUsername: z.string() }))
      .query(async ({ input }) => {
        const requester = await db.getAppUserByUsername(input.requestingUsername);
        if (!requester?.isOwner) throw new TRPCError({ code: "FORBIDDEN" });
        const rows = await db.listAppUsers();
        return rows.map(u => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          countries: JSON.parse(u.countries) as string[],
          isOwner: u.isOwner,
          createdAt: u.createdAt,
        }));
      }),
    // Create user - owner only
    create: publicProcedure
      .input(z.object({
        requestingUsername: z.string(),
        username: z.string().min(2),
        displayName: z.string().min(1),
        password: z.string().min(1),
        role: z.enum(["admin", "viewer"]),
        countries: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const requester = await db.getAppUserByUsername(input.requestingUsername);
        if (!requester?.isOwner) throw new TRPCError({ code: "FORBIDDEN" });
        const existing = await db.getAppUserByUsername(input.username);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Username already exists" });
        await db.createAppUser({
          username: input.username,
          displayName: input.displayName,
          password: input.password,
          role: input.role,
          countries: input.countries,
        });
        return { success: true };
      }),
    // Update user - owner only
    update: publicProcedure
      .input(z.object({
        requestingUsername: z.string(),
        id: z.number(),
        displayName: z.string().optional(),
        password: z.string().optional(),
        role: z.enum(["admin", "viewer"]).optional(),
        countries: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const requester = await db.getAppUserByUsername(input.requestingUsername);
        if (!requester?.isOwner) throw new TRPCError({ code: "FORBIDDEN" });
        await db.updateAppUser(input.id, {
          displayName: input.displayName,
          password: input.password,
          role: input.role,
          countries: input.countries,
        });
        return { success: true };
      }),
    // Delete user - owner only, cannot delete self
    delete: publicProcedure
      .input(z.object({
        requestingUsername: z.string(),
        id: z.number(),
      }))
      .mutation(async ({ input }) => {
        const requester = await db.getAppUserByUsername(input.requestingUsername);
        if (!requester?.isOwner) throw new TRPCError({ code: "FORBIDDEN" });
        if (requester.id === input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
        await db.deleteAppUser(input.id);
        return { success: true };
      }),
  }),

  // ==================== PRESENCE ====================
  presence: router({
    // Heartbeat: called every 30s by logged-in clients to stay "online"
    heartbeat: publicProcedure
      .input(z.object({
        username: z.string(),
        displayName: z.string(),
        country: z.string(),
        currentPage: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertPresence(input);
        return { success: true };
      }),
    // Get all users seen in the last 2 minutes
    online: publicProcedure.query(async () => {
      return db.getOnlineUsers();
    }),
    // Remove presence on logout
    leave: publicProcedure
      .input(z.object({ username: z.string() }))
      .mutation(async ({ input }) => {
        await db.removePresence(input.username);
        return { success: true };
      }),
  }),
  // ==================== FORECAST SPLIT RECOMMENDATION ====================
  forecastSplit: router({
    /**
     * Given a total tonnage, mastercase weight (kg), target month/year, and country,
     * analyse historical IMS data and return per-SKU mastercase recommendations.
     */
    recommend: publicProcedure
      .input(z.object({
        country: z.string(),
        totalTons: z.number().positive(),
        mastercaseKg: z.number().positive(),
        targetMonth: z.number().min(1).max(12),
        targetYear: z.number().min(2024).max(2030),
        includeNpi: z.boolean().optional().default(true),
        previousMonthContext: z.string().optional(),
        monthPositionInForecast: z.number().optional(),
        totalForecastDuration: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { country: countryRaw, totalTons, mastercaseKg, targetMonth, targetYear, includeNpi, previousMonthContext, monthPositionInForecast, totalForecastDuration } = input;
        const country = countryRaw as 'Lebanon' | 'Syria' | 'Libya';

        // 1. Fetch all SKUs for this country, optionally filtering out NPI
        const allSkus = await db.getSkusForCountry(country);
        const skus = includeNpi ? allSkus : allSkus.filter(s => (s.category ?? 'Core') === 'Core');
        if (!skus.length) throw new TRPCError({ code: 'NOT_FOUND', message: includeNpi ? 'No SKUs found for this country' : 'No Core SKUs found for this country (all SKUs are NPI)' });

        // 2. Fetch all IMS data for this country
        const periods = await db.getPeriodsForCountry(country);
        const imsData = await db.getImsDataForCountry(country);

        // 3. Build per-SKU monthly IMS history
        const skuHistory: Record<number, { name: string; weight: string; category: string; packagingType: string; monthlyIms: { year: number; month: number; value: number }[] }> = {};
        for (const sku of skus) {
          skuHistory[sku.id] = { name: sku.name, weight: sku.weight, category: sku.category ?? 'Core', packagingType: (sku as any).packagingType ?? 'New', monthlyIms: [] };
        }
        for (const row of imsData) {
          const period = periods.find(p => p.id === row.periodId);
          if (!period) continue;
          const val = parseFloat(row.value ?? '0') || 0;
          if (skuHistory[row.skuId]) {
            skuHistory[row.skuId].monthlyIms.push({ year: period.year, month: period.month, value: val });
          }
        }

        // 4. Fetch Planning FG data for stock health analysis
        const planningFgRaw = await db.getFullPlanningDataForCountry(country as import('../drizzle/schema').Country);
        // Compute closing stock per SKU per period: openingStock + adjustments + arrivals - ims
        // Then compute weeks of stock = (closingStock / avgNextNIms) * 4.3
        const pfgPeriodMap = new Map(planningFgRaw.periods.map(p => [p.id, p]));
        const pfgForecastMap = new Map(planningFgRaw.forecast.map(f => [`${f.skuId}-${f.periodId}`, parseFloat(f.value ?? '0') || 0]));
        const pfgImsMap = new Map(planningFgRaw.ims.map(i => [`${i.skuId}-${i.periodId}`, parseFloat(i.value ?? '0') || 0]));
        const pfgPlanMap = new Map(planningFgRaw.planningFg.map(p => [
          `${p.skuId}-${p.periodId}`,
          { opening: parseFloat(p.openingStock ?? '0') || 0, adj: parseFloat(p.adjustments ?? '0') || 0, arr: parseFloat(p.arrivals ?? '0') || 0 }
        ]));
        // Sort periods chronologically
        const pfgPeriods = [...planningFgRaw.periods].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
        // Compute closing stock and weeks per SKU per period
        const stockHealthBySku: Record<number, {
          currentWeeks: number; currentZone: string; trend: string;
          targetMonthWeeks: number; targetMonthZone: string;
          nextMonthWeeks: number; nextMonthZone: string;
          criticalPeriods: string[]; overstockPeriods: string[];
          healthScore: number;
        }> = {};
        for (const sku of planningFgRaw.skus) {
          const closingStocks: { periodId: number; label: string; cs: number }[] = [];
          let runningCS = 0;
          for (const p of pfgPeriods) {
            const plan = pfgPlanMap.get(`${sku.id}-${p.id}`) ?? { opening: 0, adj: 0, arr: 0 };
            const imsVal = pfgImsMap.get(`${sku.id}-${p.id}`) ?? 0;
            const cs = plan.opening + plan.adj + plan.arr - imsVal;
            runningCS = cs;
            closingStocks.push({ periodId: p.id, label: p.label, cs });
          }
          // Classify zone
          const classifyZone = (weeks: number) => {
            if (!isFinite(weeks) && weeks > 0) return 'Overstock';
            if (!isFinite(weeks) && weeks < 0) return 'Negative';
            if (weeks === 0) return 'Out of Stock';
            if (weeks < 0) return 'Negative';
            if (weeks < 4) return 'Critical';
            if (weeks <= 6) return 'Healthy';
            return 'Overstock';
          };
          // Compute weeks of stock for each period
          const weeksPerPeriod: { label: string; weeks: number; zone: string }[] = [];
          for (let i = 0; i < closingStocks.length; i++) {
            const { label, cs } = closingStocks[i];
            // avg of next 2 IMS values
            const nextIms = [1, 2].map(offset => {
              const nextP = pfgPeriods[i + offset];
              return nextP ? (pfgImsMap.get(`${sku.id}-${nextP.id}`) ?? pfgForecastMap.get(`${sku.id}-${nextP.id}`) ?? 0) : 0;
            });
            const avgN = nextIms.filter(v => v > 0).length > 0 ? nextIms.reduce((s, v) => s + v, 0) / nextIms.filter(v => v > 0).length : 0;
            const weeks = avgN > 0 ? (cs / avgN) * 4.3 : (cs > 0 ? 99 : cs < 0 ? -99 : 0);
            weeksPerPeriod.push({ label, weeks, zone: classifyZone(weeks) });
          }
          // Find target month period
          const targetPeriod = pfgPeriods.find(p => p.year === targetYear && p.month === targetMonth);
          const nextPeriod = pfgPeriods.find(p => p.year === (targetMonth === 12 ? targetYear + 1 : targetYear) && p.month === (targetMonth === 12 ? 1 : targetMonth + 1));
          const currentPeriod = pfgPeriods.find(p => {
            const now = new Date();
            return p.year === now.getFullYear() && p.month === now.getMonth() + 1;
          });
          const currentW = currentPeriod ? (weeksPerPeriod.find(w => w.label === currentPeriod.label)?.weeks ?? 0) : 0;
          const targetW = targetPeriod ? (weeksPerPeriod.find(w => w.label === targetPeriod.label)?.weeks ?? 0) : 0;
          const nextW = nextPeriod ? (weeksPerPeriod.find(w => w.label === nextPeriod.label)?.weeks ?? 0) : 0;
          const criticalPeriods = weeksPerPeriod.filter(w => w.zone === 'Critical' || w.zone === 'Negative' || w.zone === 'Out of Stock').map(w => w.label);
          const overstockPeriods = weeksPerPeriod.filter(w => w.zone === 'Overstock').map(w => w.label);
          const healthyCount = weeksPerPeriod.filter(w => w.zone === 'Healthy').length;
          const healthScore = weeksPerPeriod.length > 0 ? Math.round(healthyCount / weeksPerPeriod.length * 100) : 100;
          // Trend: compare first half vs second half avg weeks
          const mid = Math.floor(weeksPerPeriod.length / 2);
          const firstHalf = weeksPerPeriod.slice(0, mid).reduce((s, w) => s + Math.min(w.weeks, 12), 0) / (mid || 1);
          const secondHalf = weeksPerPeriod.slice(mid).reduce((s, w) => s + Math.min(w.weeks, 12), 0) / ((weeksPerPeriod.length - mid) || 1);
          const trend = secondHalf - firstHalf > 0.5 ? 'improving' : firstHalf - secondHalf > 0.5 ? 'deteriorating' : 'stable';
          stockHealthBySku[sku.id] = {
            currentWeeks: Math.round(currentW * 10) / 10,
            currentZone: classifyZone(currentW),
            trend,
            targetMonthWeeks: Math.round(targetW * 10) / 10,
            targetMonthZone: classifyZone(targetW),
            nextMonthWeeks: Math.round(nextW * 10) / 10,
            nextMonthZone: classifyZone(nextW),
            criticalPeriods: criticalPeriods.slice(0, 5),
            overstockPeriods: overstockPeriods.slice(0, 5),
            healthScore,
          };
        }
        // 4b. Compute total mastercases available
        const totalKg = totalTons * 1000;
        const totalMastercases = Math.floor(totalKg / mastercaseKg);
        // 5. Deep analytics per SKU
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][targetMonth - 1];
        const skuSummaries = Object.entries(skuHistory).map(([skuIdStr, sku]) => {
          const skuId = parseInt(skuIdStr);
          const sorted = [...sku.monthlyIms].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
          const nonZero = sorted.filter(m => m.value > 0);
          const totalIms = nonZero.reduce((s, m) => s + m.value, 0);
          const avgMonthly = nonZero.length ? totalIms / nonZero.length : 0;
          // 3-month rolling trend: compare last 3 months vs prior 3 months
          const last3 = nonZero.slice(-3).reduce((s, m) => s + m.value, 0) / Math.max(1, Math.min(3, nonZero.length));
          const prior3Arr = nonZero.slice(-6, -3);
          const prior3 = prior3Arr.length ? prior3Arr.reduce((s, m) => s + m.value, 0) / prior3Arr.length : 0;
          const rollingTrend = prior3 > 0 ? ((last3 - prior3) / prior3 * 100).toFixed(1) : 'N/A';
          // YoY for same month
          const sameMonthData = nonZero.filter(m => m.month === targetMonth).sort((a, b) => a.year - b.year);
          const yoyGrowth = sameMonthData.length >= 2
            ? (((sameMonthData[sameMonthData.length-1].value - sameMonthData[sameMonthData.length-2].value) / sameMonthData[sameMonthData.length-2].value) * 100).toFixed(1)
            : 'N/A';
          // Seasonality index for target month (avg of this month / overall avg)
          const sameMonthAvg = sameMonthData.length ? sameMonthData.reduce((s,m)=>s+m.value,0)/sameMonthData.length : 0;
          const seasonalityIndex = avgMonthly > 0 ? (sameMonthAvg / avgMonthly).toFixed(2) : 'N/A';
          // Full monthly history string
          const history = nonZero.map(m => `${m.year}-${String(m.month).padStart(2,'0')}:${m.value}`).join(' ');
          const sameMonthHistory = sameMonthData.map(m => `${m.year}:${m.value}`).join(' ');
          // Confidence score: based on coefficient of variation of same-month share across years
          // Low variance in share = high confidence (stable SKU); high variance = low confidence
          const shareHistory: number[] = [];
          if (sameMonthData.length >= 2) {
            // We'll compute share per year for the target month; need total per year for that month
            // Approximate: use each year's same-month value vs the avg across all SKUs for that year/month
            // We store raw values here; actual share vs total will be computed after grandTotal is known
            // For now store raw values; confidenceScore will be computed after skuSummaries is built
          }
          const nwKey = `${sku.name}|${sku.weight}`;
          const hasDuplicateNameWeight = Object.values(skuHistory).filter(s => `${s.name}|${s.weight}` === nwKey).length > 1;
          const displayName = hasDuplicateNameWeight ? `${sku.name} ${sku.weight} ${sku.packagingType}` : `${sku.name} ${sku.weight}`;
          return {
            skuId,
            name: displayName,
            rawName: sku.name,
            rawWeight: sku.weight,
            category: sku.category,
            packagingType: sku.packagingType,
            totalIms,
            avgMonthly: avgMonthly.toFixed(0),
            rollingTrend,
            yoyGrowth,
            seasonalityIndex,
            sameMonthHistory,
            history,
            monthsOfData: nonZero.length,
            sameMonthRawData: sameMonthData,
          };
        });
        const grandTotal = skuSummaries.reduce((s, sk) => s + sk.totalIms, 0);
        // Compute per-SKU confidence score based on same-month share variance
        // For each SKU, compute its share of total IMS for each year in the same target month
        // Confidence = 100 - (CV * 100) clamped to [10, 99], where CV = stddev/mean of shares
        // Build per-year totals for target month across all SKUs
        const yearTotalsForTargetMonth: Record<number, number> = {};
        for (const sk of skuSummaries) {
          for (const m of sk.sameMonthRawData) {
            yearTotalsForTargetMonth[m.year] = (yearTotalsForTargetMonth[m.year] ?? 0) + m.value;
          }
        }
        const skuConfidenceScores: Record<string, number> = {};
        for (const sk of skuSummaries) {
          const shares = sk.sameMonthRawData
            .filter(m => (yearTotalsForTargetMonth[m.year] ?? 0) > 0)
            .map(m => m.value / yearTotalsForTargetMonth[m.year]);
          if (shares.length < 2) {
            skuConfidenceScores[sk.name] = sk.monthsOfData >= 6 ? 55 : 30; // low data = low confidence
          } else {
            const mean = shares.reduce((s, v) => s + v, 0) / shares.length;
            const variance = shares.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / shares.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
            const score = Math.round(Math.min(99, Math.max(10, (1 - cv) * 100)));
            skuConfidenceScores[sk.name] = score;
          }
        }
        // Compute overall market seasonality for the target month
        const allMonthTotals: Record<number, number[]> = {};
        for (const sku of Object.values(skuHistory)) {
          for (const m of sku.monthlyIms.filter(m => m.value > 0)) {
            if (!allMonthTotals[m.month]) allMonthTotals[m.month] = [];
            allMonthTotals[m.month].push(m.value);
          }
        }
        const overallMonthAvg: Record<number, number> = {};
        for (const [mo, vals] of Object.entries(allMonthTotals)) {
          overallMonthAvg[Number(mo)] = (vals as number[]).reduce((s,v)=>s+v,0)/(vals as number[]).length;
        }
        const overallAvgAllMonths = Object.values(overallMonthAvg).reduce((s,v)=>s+v,0) / Math.max(1, Object.keys(overallMonthAvg).length);
        const marketSeasonalityIndex = overallAvgAllMonths > 0 ? (overallMonthAvg[targetMonth] / overallAvgAllMonths).toFixed(2) : '1.00';
                // 6. Build market intelligence context per country
        const countryIntelligence = (() => {
          const base = {
            Lebanon: {
              marketContext: `Lebanon is one of the highest tobacco-consuming countries globally (ranked 3rd per capita). Hookah is deeply embedded in social culture. The country faces a severe economic crisis since 2019 — USD-priced imports are premium goods. Tobacco consumption paradoxically increased from 32% pre-2019 to 61% in 2024 (stress-driven). Al Fakher is the dominant premium shisha brand, competing primarily with Nakhla (budget, JTI/Egypt), Mazaya (Jordan), and local Lebanese brands.`,
              competitors: `Nakhla (JTI/Egypt) — budget segment, strong in cost-sensitive households. Mazaya (Jordan) — mid-range. Romman (Jordan) — niche. Local Lebanese brands — very low price point. Al Fakher holds the premium segment with ~40% global market share.`,
              economicPressure: `High. Currency devaluation means consumers are price-sensitive. 250g is the dominant retail size. 1kg is primarily for hookah lounges and cafés. Premium SKUs may face substitution pressure from cheaper alternatives.`,
              ramadanFactor: `+35% demand spike in the Ramadan month (night socializing after iftar, extended café hours). Ramadan is the single most important demand driver in Lebanon.`,
              summerFactor: `+20-25% in Jun-Aug (outdoor cafes, tourism, social gatherings on the coast).`,
              winterFactor: `-10-15% in Dec-Feb (reduced outdoor activity, economic pressure).`,
              topFlavorTiers: `Tier 1 (anchor SKUs, always high demand): Double Apple, Mint, Grape with Mint, Blueberry, Watermelon. Tier 2 (strong performers): Peach, Orange Mint, Strawberry, Lemon Mint, Grape. Tier 3 (niche/seasonal): Mango, Coconut, Bubblegum, Rose, Vanilla.`,
              growthOutlook: `Flat to slightly declining in volume due to economic crisis, but premiumization trend supports Al Fakher's position. Double Apple remains the #1 SKU by a wide margin in the Levant.`,
            },
            Syria: {
              marketContext: `Syria is in post-conflict reconstruction with limited import capacity. Strong domestic hookah culture. USD scarcity limits premium imports. Al Fakher is the aspirational premium brand, competing with local Syrian brands and Egyptian Nakhla.`,
              competitors: `Nakhla (JTI/Egypt) — strong budget competitor. Local Syrian brands — very price-competitive. Mazaya (Jordan) — mid-range. Al Fakher holds premium positioning.`,
              economicPressure: `Very high. USD scarcity is a hard constraint on import volumes. 250g is the most accessible size. Lounge/café sector is recovering but still below pre-war levels.`,
              ramadanFactor: `+35% demand spike in the Ramadan month. Night culture during Ramadan is a key driver.`,
              summerFactor: `+15-20% in Jun-Aug (outdoor socializing, recovering café sector).`,
              winterFactor: `-10-15% in Dec-Feb.`,
              topFlavorTiers: `Tier 1: Double Apple (dominant in Syria — anise-apple is the traditional Levantine flavor), Mint, Grape with Mint. Tier 2: Blueberry, Watermelon, Peach, Orange. Tier 3: Strawberry, Lemon, Mango.`,
              growthOutlook: `Recovering. Gradual volume growth as reconstruction progresses. Double Apple is overwhelmingly dominant in Syria — often 40-50% of total volume.`,
            },
            Libya: {
              marketContext: `Libya is an oil-rich but politically unstable North African market. Strong hookah culture with deep roots. Al Fakher competes with Egyptian brands (Nakhla, Eastern Company) which have strong distribution via Egypt-Libya trade routes. Three local Libyan brands (Mars, Tanit, Crystal) dominate cigarettes but hookah is import-driven.`,
              competitors: `Nakhla (JTI/Egypt) — strong competitor with geographic proximity advantage. Eastern Company (Egypt) — bulk supply to Libya. Mazaya (Jordan) — growing presence. Al Fakher holds the premium segment.`,
              economicPressure: `Moderate. Oil revenues support purchasing power but political instability creates supply chain risks. 250g and 1kg both have strong demand.`,
              ramadanFactor: `+40% demand spike — strongest Ramadan effect in North Africa. Extended night socializing, family gatherings.`,
              summerFactor: `+15-20% in Jun-Aug (outdoor culture, Mediterranean summer).`,
              winterFactor: `-5-10% in Dec-Feb (milder than Lebanon/Syria).`,
              topFlavorTiers: `Tier 1: Double Apple, Mint, Grape with Mint, Blueberry. Tier 2: Watermelon, Peach, Orange Mint, Strawberry. Tier 3: Lemon, Mango, Rose.`,
              growthOutlook: `Growing. Libya is an underpenetrated market with upside potential. Al Fakher has strong brand equity. Supply chain reliability is the main constraint.`,
            },
          };
          return base[country as keyof typeof base] ?? base.Lebanon;
        })();

        // 7. Compute Ramadan adjustment for target month
        // Ramadan dates (Hijri calendar, approximate Gregorian overlap):
        // 2024: Mar-Apr (months 3-4). 2025: Mar (month 3). 2026: Feb-Mar (months 2-3). 2027: Jan-Feb (months 1-2). 2028: Jan (month 1). 2029: Dec 2028-Jan 2029 (months 12,1). 2030: Dec 2029-Jan 2030 (months 12,1).
        // NOTE: Ramadan 2026 ends ~Mar 19 2026. April, May, June 2026 are NOT Ramadan.
        const ramadanMonths: Record<number, number[]> = { 2024: [3, 4], 2025: [3], 2026: [2, 3], 2027: [1, 2], 2028: [1], 2029: [1, 12], 2030: [1, 12] };
        const isRamadanMonth = (ramadanMonths[targetYear] ?? []).includes(targetMonth);
        const ramadanBoostPct = isRamadanMonth
          ? (country === 'Libya' ? 40 : 35)
          : 0;
        const ramadanNote = isRamadanMonth
          ? `${monthName} ${targetYear} falls in Ramadan — expect +${ramadanBoostPct}% demand uplift driven by night socializing, extended café hours, and gifting culture. This is the single most important seasonal driver in ${country}.`
          : `${monthName} ${targetYear} is not a Ramadan month. Check for summer (+15-25% Jun-Aug) or winter (-10-15% Dec-Feb) adjustments.`;

        // 7b. Expert seasonal calendar — month-by-month intelligence
        const seasonalCalendar: Record<number, { label: string; effect: string; multiplier: string }> = {
          1:  { label: 'January',   effect: 'Post-holiday restocking. Distributors rebuild inventory after December slowdown. Moderate demand recovery.', multiplier: '0.90-0.95' },
          2:  { label: 'February',  effect: 'Pre-Ramadan stocking begins (if Ramadan is in March). Winter tail-end. Steady demand.', multiplier: '0.92-1.00' },
          3:  { label: 'March',     effect: 'Often Ramadan month (2024-2026). If Ramadan: +35-40% spike. If not: spring transition, gradual demand increase.', multiplier: '1.00-1.40' },
          4:  { label: 'April',     effect: 'Post-Ramadan normalization or late Ramadan. Eid al-Fitr celebrations can sustain elevated demand for 1-2 weeks.', multiplier: '0.95-1.15' },
          5:  { label: 'May',       effect: 'Spring-to-summer transition. Outdoor café season begins. Gradual demand increase.', multiplier: '1.00-1.10' },
          6:  { label: 'June',      effect: 'Summer season starts. Outdoor socializing, tourism, Mediterranean café culture. +15-25% uplift.', multiplier: '1.15-1.25' },
          7:  { label: 'July',      effect: 'Peak summer month. Highest outdoor consumption. Tourism at maximum. Strong demand.', multiplier: '1.20-1.30' },
          8:  { label: 'August',    effect: 'Late summer. Still elevated but beginning to taper. Back-to-school effect in some markets.', multiplier: '1.10-1.20' },
          9:  { label: 'September', effect: 'Summer wind-down. Return to normal consumption patterns. Moderate demand.', multiplier: '0.95-1.05' },
          10: { label: 'October',   effect: 'Autumn. Stable demand. Pre-winter stocking may begin for some distributors.', multiplier: '0.95-1.00' },
          11: { label: 'November',  effect: 'Pre-year-end. Distributors may front-load orders to meet annual targets. Slight uptick possible.', multiplier: '0.95-1.05' },
          12: { label: 'December',  effect: 'YEAR-END CLOSING. Significant slowdown in ordering. Distributors minimize inventory to close books. Holiday period reduces café traffic. -15-25% dip typical. Many distributors place minimal orders.', multiplier: '0.75-0.85' },
        };
        const currentSeasonalInfo = seasonalCalendar[targetMonth];

        // 7c. Year-end closing intelligence
        const isYearEnd = targetMonth === 12;
        const isQ4 = targetMonth >= 10;
        const isJanRestock = targetMonth === 1;
        const yearEndContext = isYearEnd
          ? `\n⚠ YEAR-END CLOSING MONTH (December ${targetYear}):\n- Distributors typically reduce orders by 15-25% to minimize year-end inventory on their books\n- Café and lounge traffic drops during holiday/vacation period\n- Focus on core/anchor SKUs (Double Apple, Mint) — distributors cut NPI and niche flavors first\n- Some distributors may have already front-loaded November orders to meet annual targets\n- Recommend conservative allocation: reduce NPI by 20-30%, maintain Core at 85-90% of normal levels\n- January ${targetYear + 1} will see a restocking bounce — plan accordingly`
          : isQ4
          ? `\nQ4 CONTEXT (${monthName} ${targetYear}):\n- Approaching year-end. Distributors may adjust ordering patterns to manage annual inventory targets.\n- ${targetMonth === 11 ? 'November often sees front-loading of orders before December slowdown.' : 'October is typically stable with normal ordering patterns.'}\n- Monitor distributor behavior for early signs of year-end inventory reduction.`
          : isJanRestock
          ? `\nJANUARY RESTOCKING (${targetYear}):\n- Post year-end restocking period. Distributors rebuild depleted inventory from December slowdown.\n- Expect 10-15% above-normal ordering as pipeline refills.\n- Good opportunity to push NPI SKUs as distributors are open to refreshing their product mix.\n- Anchor SKUs (Double Apple, Mint) will see strongest restocking demand.`
          : '';

        // 7d. Progressive month-over-month context (for multi-month forecasts)
        const progressiveContext = previousMonthContext
          ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSECTION F: PROGRESSIVE CONTEXT — PREVIOUS MONTH RECOMMENDATIONS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThis is month ${monthPositionInForecast ?? '?'} of ${totalForecastDuration ?? '?'} in a multi-month forecast.\nThe previous month\'s AI-recommended split was:\n${previousMonthContext}\n\nIMPORTANT PROGRESSIVE RULES:\n- Maintain momentum: if a SKU was trending up last month, continue the trajectory unless seasonal factors change\n- Smooth transitions: avoid >15% month-over-month swings in any single SKU\'s share unless justified by Ramadan/year-end/seasonal shift\n- Depletion curves: if stock was critical last month and you boosted allocation, check if the boost was sufficient or needs continuation\n- Seasonal transitions: if moving from summer→autumn or autumn→winter, gradually reduce seasonal SKUs rather than cliff-dropping\n- Year-end approach: if approaching December, start gradually reducing NPI allocations from October onwards\n- Post-Ramadan: if last month was Ramadan, normalize allocations but don\'t crash — Eid celebrations sustain demand for 1-2 weeks`
          : '';

        // 8. Pre-compute algorithmic base scores per SKU (5-factor weighted model)
        // Factor weights: Historical trend 35%, Seasonality 25%, Stock health 20%, Market intel 10%, Confidence 10%
        const skuBaseScores: Record<string, number> = {};
        let totalBaseScore = 0;
        for (const sk of skuSummaries) {
          const conf = skuConfidenceScores[sk.name] ?? 50;
          const skuObj = skus.find(s => s.id === sk.skuId);
          const health = skuObj ? stockHealthBySku[skuObj.id] : null;

          // Factor 1: Historical trend score (35%) — based on avg monthly IMS relative to total
          const historicalShare = grandTotal > 0 ? (sk.totalIms / grandTotal) : (1 / Math.max(1, skuSummaries.length));
          const trendMultiplier = (() => {
            const rt = parseFloat(String(sk.rollingTrend));
            if (isNaN(rt)) return 1.0;
            if (rt > 20) return 1.15;
            if (rt > 10) return 1.08;
            if (rt > 0) return 1.03;
            if (rt > -10) return 0.97;
            if (rt > -20) return 0.92;
            return 0.85;
          })();
          const f1 = historicalShare * trendMultiplier * 0.35;

          // Factor 2: Seasonality score (25%) — SKU-specific seasonality index
          const si = parseFloat(String(sk.seasonalityIndex));
          const seasonalityMultiplier = isNaN(si) ? 1.0 : Math.min(2.0, Math.max(0.5, si));
          const f2 = historicalShare * seasonalityMultiplier * 0.25;

          // Factor 3: Stock health score (20%) — critical = boost, overstock = reduce
          const stockMultiplier = (() => {
            if (!health) return 1.0;
            const zone = health.targetMonthZone;
            if (zone === 'Critical' || zone === 'Negative' || zone === 'Out of Stock') return 1.20;
            if (zone === 'Overstock') return 0.82;
            return 1.0;
          })();
          const f3 = historicalShare * stockMultiplier * 0.20;

          // Factor 4: Market intelligence score (10%) — SKU tier ranking
          const skuNameLower = sk.name.toLowerCase();
          const tierMultiplier = (() => {
            // Tier 1 anchor SKUs
            if (skuNameLower.includes('double apple') || skuNameLower.includes('two apple')) return 1.15;
            if (skuNameLower.includes('mint') && !skuNameLower.includes('grape') && !skuNameLower.includes('orange') && !skuNameLower.includes('lemon') && !skuNameLower.includes('blue')) return 1.10;
            if (skuNameLower.includes('grape') && skuNameLower.includes('mint')) return 1.08;
            if (skuNameLower.includes('blueberry') || skuNameLower.includes('blue berry')) return 1.05;
            if (skuNameLower.includes('watermelon')) return 1.03;
            // Tier 2
            if (skuNameLower.includes('peach') || skuNameLower.includes('orange') || skuNameLower.includes('strawberry') || skuNameLower.includes('lemon') || skuNameLower.includes('grape')) return 1.0;
            // Tier 3 / NPI
            return 0.95;
          })();
          const f4 = historicalShare * tierMultiplier * 0.10;

          // Factor 5: Confidence score (10%)
          const f5 = historicalShare * (conf / 100) * 0.10;

          const baseScore = f1 + f2 + f3 + f4 + f5;
          skuBaseScores[sk.name] = baseScore;
          totalBaseScore += baseScore;
        }
        // Normalize base scores to get base allocation percentages
        const skuBaseAllocPct: Record<string, number> = {};
        for (const sk of skuSummaries) {
          skuBaseAllocPct[sk.name] = totalBaseScore > 0 ? (skuBaseScores[sk.name] / totalBaseScore) * 100 : (100 / skuSummaries.length);
        }

        // 9. Call LLM for intelligent split with deep market intelligence
        const prompt = `You are acting as a SENIOR FMCG DEMAND PLANNER and DATA ANALYST for Al Fakher tobacco products in ${country}. Your analysis must reflect deep knowledge of the shisha tobacco market, cultural consumption patterns, competitive dynamics, and supply chain constraints.

═══════════════════════════════════════════════════════════════
MISSION: Recommend how to split ${totalMastercases} mastercases (${totalTons} tons, ${mastercaseKg}kg each) across all SKUs for ${monthName} ${targetYear}.
═══════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION A: COUNTRY MARKET INTELLIGENCE — ${country}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Market Context: ${countryIntelligence.marketContext}
Competitive Landscape: ${countryIntelligence.competitors}
Economic Pressure: ${countryIntelligence.economicPressure}
Ramadan Effect: ${countryIntelligence.ramadanFactor}
Summer Effect: ${countryIntelligence.summerFactor}
Winter Effect: ${countryIntelligence.winterFactor}
SKU Flavor Tiers (global + regional preference): ${countryIntelligence.topFlavorTiers}
Growth Outlook: ${countryIntelligence.growthOutlook}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION B: SEASONAL & RAMADAN ANALYSIS FOR ${monthName} ${targetYear}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ramadanNote}
Market seasonality index for ${monthName} (from historical IMS data): ${marketSeasonalityIndex}
(1.0 = average month, >1.0 = above average demand, <1.0 = below average demand)

EXPERT SEASONAL CALENDAR for ${monthName}:
- Effect: ${currentSeasonalInfo.effect}
- Expected multiplier range: ${currentSeasonalInfo.multiplier}x of average month
${isRamadanMonth ? `⚠ RAMADAN MONTH DETECTED: Apply +${ramadanBoostPct}% demand uplift to Tier 1 SKUs (Double Apple, Mint, Grape with Mint). Traditional flavors spike during Ramadan. Fruity/exotic flavors also benefit but less so.` : ''}
${yearEndContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION C: ALGORITHMIC BASE ALLOCATION (5-Factor Model)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed base allocation percentages (use as starting point, adjust with your analysis):
${skuSummaries.map(s => `  ${s.name}: ${skuBaseAllocPct[s.name].toFixed(1)}% base → ${Math.round(totalMastercases * skuBaseAllocPct[s.name] / 100)} mastercases`).join('\n')}
Factors used: Historical trend (35%) + Seasonality (25%) + Stock health (20%) + Market intel/flavor tier (10%) + Confidence (10%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION D: PER-SKU DETAILED ANALYTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total historical IMS: ${grandTotal.toFixed(0)} mastercases | Data depth: ${Math.max(...Object.values(skuHistory).map(s => s.monthlyIms.length))} months
${skuSummaries.map(s => {
  const skuObj = skus.find(sk => sk.id === s.skuId);
  const health = skuObj ? stockHealthBySku[skuObj.id] : null;
  const conf = skuConfidenceScores[s.name] ?? 50;
  const baseAlloc = skuBaseAllocPct[s.name]?.toFixed(1) ?? 'N/A';
  return [
    `▸ SKU: ${s.name} [${s.category}] | Packaging: ${s.packagingType} | Base alloc: ${baseAlloc}% | Confidence: ${conf}%`,
    `  IMS: avg/month=${s.avgMonthly} | total=${s.totalIms.toFixed(0)} | months of data=${s.monthsOfData}`,
    `  Trend: 3-month rolling vs prior 3 months: ${s.rollingTrend}% | YoY same month: ${s.yoyGrowth}%`,
    `  Seasonality index for ${monthName}: ${s.seasonalityIndex} | Same month prior years: ${s.sameMonthHistory || 'no data'}`,
    `  Full monthly history: ${s.history || 'no data'}`,
    health ? `  STOCK HEALTH: Now=${health.currentWeeks}wks [${health.currentZone}] | ${monthName}=${health.targetMonthWeeks}wks [${health.targetMonthZone}] | Next=${health.nextMonthWeeks}wks [${health.nextMonthZone}] | Health score=${health.healthScore}% | Trend=${health.trend}` : '  STOCK HEALTH: No Planning FG data available',
    health && health.criticalPeriods.length > 0 ? `  ⚠ CRITICAL STOCK PERIODS: ${health.criticalPeriods.join(', ')} — MUST increase allocation` : '',
    health && health.overstockPeriods.length > 0 ? `  ⚠ OVERSTOCK PERIODS: ${health.overstockPeriods.join(', ')} — MUST reduce allocation` : '',
  ].filter(Boolean).join('\n');
}).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION E: DECISION FRAMEWORK — APPLY IN THIS ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. STOCK HEALTH OVERRIDE (highest priority): SKUs in Critical/Negative/Out-of-Stock zones MUST receive +15-25% above base allocation. SKUs in Overstock zones MUST receive -10-20% below base allocation. This is non-negotiable.
2. RAMADAN/SEASONAL ADJUSTMENT: ${isRamadanMonth ? `Apply +${ramadanBoostPct}% uplift to Tier 1 SKUs (Double Apple, Mint, Grape with Mint). Distribute the extra volume from overstocked/declining SKUs.` : 'Apply seasonal index adjustments. Summer months boost fruity SKUs; winter months reduce overall demand.'}
3. TREND MOMENTUM: SKUs with >+10% rolling trend deserve above-base allocation. SKUs with >-10% rolling trend should be reduced below base.
4. MARKET INTELLIGENCE: Double Apple is the anchor SKU in ${country} — never allocate below 25% of its historical share unless severely overstocked. Mint is the universal mixer — maintain consistent supply. NPI SKUs with <6 months data should be allocated conservatively (max 5% above base) unless early data shows exceptional traction.
5. COMPETITIVE CONTEXT: In ${country}, Al Fakher competes primarily with ${country === 'Lebanon' ? 'Nakhla and Mazaya' : country === 'Syria' ? 'Nakhla and local Syrian brands' : 'Nakhla and Eastern Company Egypt'}. Premium SKUs (Tier 1) should be prioritized as they are harder for competitors to match.
6. YEAR-END / Q4 ADJUSTMENT: ${isYearEnd ? 'THIS IS DECEMBER — apply year-end closing logic: reduce NPI by 20-30%, maintain Core at 85-90% of normal. Distributors are minimizing inventory.' : isQ4 ? `Q4 month — be aware of approaching year-end patterns. ${targetMonth === 11 ? 'November may see front-loading before December slowdown.' : 'October is typically stable.'}` : isJanRestock ? 'JANUARY RESTOCKING — expect above-normal demand as distributors rebuild after December. Good time for NPI push.' : 'No special year-end adjustment needed for this month.'}
7. SMOOTH TRANSITIONS: ${previousMonthContext ? 'This is part of a multi-month forecast. Avoid >15% month-over-month swings in any SKU share unless justified by seasonal shift, Ramadan, or year-end closing.' : 'Single month forecast — optimize for this month independently.'}
8. BALANCE: Ensure the sum of all recommendedMastercases equals EXACTLY ${totalMastercases}. Round to whole numbers.

${progressiveContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED OUTPUT FORMAT (valid JSON only, no markdown):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "recommendations": [
    {
      "skuName": string,
      "weight": string,
      "category": string,
      "packagingType": string ("Old" or "New" — the packaging type for this SKU),
      "recommendedMastercases": number (integer, sum must equal ${totalMastercases}),
      "sharePercent": number (sum must equal 100.0),
      "reasoning": string (2-3 sentences: cite specific data — IMS trend, stock health zone, seasonality index, market intel),
      "trend": "growing" | "stable" | "declining" | "new",
      "seasonalityNote": string (specific note on ${monthName} seasonality for this SKU, including Ramadan/summer/winter effect if applicable),
      "stockAlert": "critical" | "healthy" | "overstock" | "unknown",
      "confidenceScore": number (0-100, adjust from base confidence using trend consistency + stock health clarity + data depth),
      "primaryDriver": string (the single most important factor driving this recommendation: one of "stock_critical" | "stock_overstock" | "ramadan_uplift" | "summer_peak" | "winter_dip" | "trend_growth" | "trend_decline" | "historical_share" | "market_intel" | "low_data". IMPORTANT: Only use "ramadan_uplift" if the target month is actually a Ramadan month — ${isRamadanMonth ? `${monthName} ${targetYear} IS a Ramadan month` : `${monthName} ${targetYear} is NOT a Ramadan month, do NOT use ramadan_uplift`}),
      "marketIntelligenceNote": string (1 sentence on how ${country} market dynamics, competitive context, or flavor tier affects this SKU)
    }
  ],
  "overallInsight": string (4-5 sentences: strategic summary covering dominant SKUs, seasonal/Ramadan adjustments made, stock health risks addressed, competitive context, and key risks or opportunities for ${country} in ${monthName} ${targetYear}),
  "warnings": string[] (critical alerts: stock-outs, overstocks, data gaps, competitive risks),
  "marketSummary": string (2-3 sentences: Al Fakher's position in ${country} for ${monthName} ${targetYear}, key demand drivers, and outlook)
}`;
        let parsed: any;
        const hasLlmKey = !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_KEY.trim());

        if (hasLlmKey) {
          try {
            const llmResponse = await invokeLLM({
              messages: [
                { role: 'system', content: 'You are a senior FMCG demand planner and data analyst specializing in the Middle East and North Africa shisha tobacco market. You have deep expertise in Al Fakher products, regional consumption patterns, Ramadan seasonality, and competitive dynamics. Always respond with valid JSON only, no markdown.' },
                { role: 'user', content: prompt },
              ],
              response_format: { type: 'json_object' },
            });
            const rawContent = llmResponse.choices[0].message.content;
            const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
            try {
              parsed = JSON.parse(content);
            } catch {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'LLM returned invalid JSON' });
            }
          } catch (llmErr: any) {
            console.warn('[ForecastSplit] LLM call failed, falling back to algorithmic model:', llmErr?.message);
            parsed = null;
          }
        }

        if (!parsed) {
          const algorithmicRecs = skuSummaries.map(sk => {
            const allocPct = skuBaseAllocPct[sk.name] ?? 0;
            const mc = Math.round(totalMastercases * allocPct / 100);
            const skuObj = skus.find(s => s.id === sk.skuId);
            const health = skuObj ? stockHealthBySku[skuObj.id] : null;
            const conf = skuConfidenceScores[sk.name] ?? 50;

            let trend: string = 'stable';
            const rt = parseFloat(String(sk.rollingTrend));
            if (!isNaN(rt)) { if (rt > 10) trend = 'growing'; else if (rt < -10) trend = 'declining'; }
            if (sk.monthsOfData < 3) trend = 'new';

            let stockAlert = 'unknown';
            if (health) {
              const zone = health.targetMonthZone;
              if (zone === 'Critical' || zone === 'Negative' || zone === 'Out of Stock') stockAlert = 'critical';
              else if (zone === 'Overstock') stockAlert = 'overstock';
              else if (zone === 'Healthy') stockAlert = 'healthy';
            }

            let primaryDriver = 'historical_share';
            if (health) {
              const driverZone = health.targetMonthZone ?? health.currentZone;
              if (driverZone === 'Critical' || driverZone === 'Negative' || driverZone === 'Out of Stock') primaryDriver = 'stock_critical';
              else if (driverZone === 'Overstock') primaryDriver = 'stock_overstock';
            }
            if (isRamadanMonth && sk.name.toLowerCase().includes('double apple')) primaryDriver = 'ramadan_uplift';
            if (targetMonth >= 6 && targetMonth <= 8 && primaryDriver === 'historical_share') primaryDriver = 'summer_peak';
            if ((targetMonth === 12 || targetMonth <= 2) && primaryDriver === 'historical_share') primaryDriver = 'winter_dip';
            if (!isNaN(rt) && rt > 10 && primaryDriver === 'historical_share') primaryDriver = 'trend_growth';
            if (!isNaN(rt) && rt < -10 && primaryDriver === 'historical_share') primaryDriver = 'trend_decline';

            const si = parseFloat(String(sk.seasonalityIndex));
            const seasonalityNote = `Seasonality index for ${monthName}: ${isNaN(si) ? 'N/A' : si.toFixed(2)}. ${isRamadanMonth ? `Ramadan effect applies (+${ramadanBoostPct}%).` : currentSeasonalInfo.effect}`;

            return {
              skuName: sk.rawName,
              weight: sk.rawWeight,
              category: sk.category,
              packagingType: sk.packagingType,
              recommendedMastercases: mc,
              sharePercent: Math.round(allocPct * 10) / 10,
              reasoning: `Based on ${sk.monthsOfData} months of IMS data. Average monthly: ${sk.avgMonthly}. Rolling trend: ${sk.rollingTrend}%. ${health ? `Stock health: ${health.currentWeeks}wks [${health.currentZone}].` : ''}`,
              trend,
              seasonalityNote,
              stockAlert,
              confidenceScore: conf,
              primaryDriver,
              marketIntelligenceNote: `${sk.category} SKU in ${country}. YoY growth: ${sk.yoyGrowth}%.`,
            };
          });

          let allocated = algorithmicRecs.reduce((s, r) => s + r.recommendedMastercases, 0);
          let diff = totalMastercases - allocated;
          if (diff !== 0 && algorithmicRecs.length > 0) {
            algorithmicRecs.sort((a, b) => b.recommendedMastercases - a.recommendedMastercases);
            let i = 0;
            const maxIter = algorithmicRecs.length * Math.abs(diff) + algorithmicRecs.length;
            let iter = 0;
            while (diff !== 0 && iter < maxIter) {
              const idx = i % algorithmicRecs.length;
              if (diff > 0) {
                algorithmicRecs[idx].recommendedMastercases += 1;
                diff -= 1;
              } else if (algorithmicRecs[idx].recommendedMastercases > 0) {
                algorithmicRecs[idx].recommendedMastercases -= 1;
                diff += 1;
              }
              i++;
              iter++;
            }
          }

          const finalTotal = algorithmicRecs.reduce((s, r) => s + r.recommendedMastercases, 0);
          algorithmicRecs.forEach(r => {
            r.sharePercent = finalTotal > 0 ? Math.round(r.recommendedMastercases / finalTotal * 1000) / 10 : 0;
          });

          const warnings: string[] = [];
          const critSkus = algorithmicRecs.filter(r => r.stockAlert === 'critical');
          if (critSkus.length > 0) warnings.push(`${critSkus.length} SKU(s) in critical stock zone: ${critSkus.map(r => r.skuName).join(', ')}`);
          const overSkus = algorithmicRecs.filter(r => r.stockAlert === 'overstock');
          if (overSkus.length > 0) warnings.push(`${overSkus.length} SKU(s) overstocked: ${overSkus.map(r => r.skuName).join(', ')}`);

          parsed = {
            recommendations: algorithmicRecs,
            overallInsight: `Algorithmic 5-factor model allocation for ${monthName} ${targetYear} in ${country}. ${totalMastercases} mastercases split across ${skus.length} SKUs using historical trend (35%), seasonality (25%), stock health (20%), market intelligence (10%), and confidence (10%). ${isRamadanMonth ? `Ramadan uplift of +${ramadanBoostPct}% applied to anchor SKUs.` : currentSeasonalInfo.effect} ${critSkus.length > 0 ? `Warning: ${critSkus.length} SKU(s) in critical stock.` : 'All stock levels within acceptable range.'}`,
            warnings,
            marketSummary: `Al Fakher ${country} forecast for ${monthName} ${targetYear}. Market seasonality index: ${marketSeasonalityIndex}. ${countryIntelligence.growthOutlook}`,
          };
        }

        const recommendations = (parsed.recommendations ?? []).map((rec: any) => {
          if (!isRamadanMonth && rec.primaryDriver === 'ramadan_uplift') {
            const skuObj = rec.packagingType
              ? skus.find(sk => sk.name === rec.skuName && sk.weight === rec.weight && (sk as any).packagingType === rec.packagingType)
              : skus.find(sk => sk.name === rec.skuName && sk.weight === rec.weight) ?? skus.find(sk => sk.name === rec.skuName);
            const health = skuObj ? stockHealthBySku[skuObj.id] : null;
            let correctedDriver = 'historical_share';
            if (health) {
              if (health.currentZone === 'Critical' || health.currentZone === 'Negative' || health.currentZone === 'Out of Stock') correctedDriver = 'stock_critical';
              else if (health.currentZone === 'Overstock') correctedDriver = 'stock_overstock';
            }
            if (targetMonth >= 6 && targetMonth <= 8) correctedDriver = 'summer_peak';
            if (targetMonth === 12 || targetMonth <= 2) correctedDriver = 'winter_dip';
            rec.primaryDriver = correctedDriver;
          }
          if (!isRamadanMonth && rec.seasonalityNote) {
            rec.seasonalityNote = rec.seasonalityNote
              .replace(/[Rr]amadan[\s-]*(related|driven|uplift|boost|spike|effect|demand|month|period|season)?/gi, 'seasonal')
              .replace(/\s+/g, ' ').trim();
          }
          return rec;
        });

        let overallInsight = parsed.overallInsight ?? '';
        if (!isRamadanMonth && overallInsight.toLowerCase().includes('ramadan')) {
          overallInsight = overallInsight
            .replace(/[Rr]amadan[\s-]*(related|driven|uplift|boost|spike|effect|demand|adjustment|month|period|season)?/gi, 'seasonal')
            .replace(/\s+/g, ' ').trim();
        }

        return {
          totalTons,
          totalMastercases,
          mastercaseKg,
          targetMonth,
          targetYear,
          country,
          recommendations,
          overallInsight,
          warnings: parsed.warnings ?? [],
          marketSummary: parsed.marketSummary ?? '',
          isRamadanMonth,
          ramadanBoostPct,
          marketSeasonalityIndex: parseFloat(marketSeasonalityIndex),
        };
      }),
    applyToForecast: protectedProcedure
      .input(z.object({
        country: z.string(),
        targetMonth: z.number().int().min(1).max(12),
        targetYear: z.number().int().min(2020).max(2035),
        mastercaseKg: z.number().positive(),
        recommendations: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          recommendedMastercases: z.number().int().min(0),
        })),
        username: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const country = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const allSkus = await db.getSkusForCountry(country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const period = allPeriods.find(p => p.year === input.targetYear && p.month === input.targetMonth);
        if (!period) throw new TRPCError({ code: 'NOT_FOUND', message: `No period found for ${input.targetYear}-${input.targetMonth} in ${country}` });
        // Snapshot previous values before overwriting
        const snapshot: { skuName: string; weight: string; packagingType?: string; previousValue: string; previousImsValue: string }[] = [];
        let applied = 0;
        for (const rec of input.recommendations) {
          let sku = rec.packagingType
            ? allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight && (s as any).packagingType === rec.packagingType)
            : null;
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          const currentRows = await db.getForecastValueForPeriod(sku.id, period.id);
          const currentIms = await db.getImsValueForPeriod(sku.id, period.id);
          snapshot.push({ skuName: rec.skuName, weight: rec.weight, packagingType: rec.packagingType, previousValue: currentRows ?? '0', previousImsValue: currentIms ?? '0' });
          const value = rec.recommendedMastercases.toString();
          // Write to Forecast
          await db.upsertForecastData(sku.id, period.id, value);
          // Also write to IMS (so IMS vs Forecast page reflects the same values)
          await db.upsertImsData(sku.id, period.id, value, false);
          applied++;
        }
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][input.targetMonth - 1];
        await db.logAudit({
          username: input.username || ctx.user?.name || 'System',
          action: 'edit',
          sheet: 'Forecast',
          details: `Applied AI recommended forecast split to ${monthName} ${input.targetYear} for ${country} — ${applied} SKUs updated (Forecast + IMS)`,
        });
        return { success: true, applied, snapshot };
      }),
    undoApply: protectedProcedure
      .input(z.object({
        country: z.string(),
        targetMonth: z.number().int().min(1).max(12),
        targetYear: z.number().int().min(2020).max(2035),
        snapshot: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          previousValue: z.string(),
          previousImsValue: z.string().optional(),
        })),
        username: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const country = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const allSkus = await db.getSkusForCountry(country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const period = allPeriods.find(p => p.year === input.targetYear && p.month === input.targetMonth);
        if (!period) throw new TRPCError({ code: 'NOT_FOUND', message: `No period found for ${input.targetYear}-${input.targetMonth} in ${country}` });
        let restored = 0;
        for (const snap of input.snapshot) {
          let sku = snap.packagingType
            ? allSkus.find(s => s.name === snap.skuName && s.weight === snap.weight && (s as any).packagingType === snap.packagingType)
            : null;
          if (!sku) sku = allSkus.find(s => s.name === snap.skuName && s.weight === snap.weight);
          if (!sku) sku = allSkus.find(s => s.name === snap.skuName);
          if (!sku) continue;
          // Restore Forecast
          await db.upsertForecastData(sku.id, period.id, snap.previousValue);
          // Restore IMS to previous value
          if (snap.previousImsValue !== undefined) {
            await db.upsertImsData(sku.id, period.id, snap.previousImsValue, false);
          }
          restored++;
        }
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][input.targetMonth - 1];
        await db.logAudit({
          username: input.username || ctx.user?.name || 'System',
          action: 'edit',
          sheet: 'Forecast',
          details: `Undid AI recommended forecast split for ${monthName} ${input.targetYear} in ${country} — ${restored} SKUs restored (Forecast + IMS)`,
        });
        return { success: true, restored };
      }),
    bulkApplyToForecast: protectedProcedure
      .input(z.object({
        country: z.string(),
        months: z.array(z.object({ month: z.number().min(1).max(12), year: z.number() })).min(1).max(12),
        recommendations: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          recommendedMastercases: z.number(),
          sharePercent: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const typedCountry = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const { months, recommendations } = input;
        const skus = await db.getSkusForCountry(typedCountry);
        const allPeriods = await db.getPeriodsForCountry(typedCountry);
        let totalApplied = 0;
        const monthResults: Array<{ month: number; year: number; applied: number }> = [];
        for (const { month, year } of months) {
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1];
          const period = allPeriods.find(p => p.month === month && p.year === year);
          if (!period) {
            monthResults.push({ month, year, applied: 0 });
            continue;
          }
          let applied = 0;
          for (const rec of recommendations) {
            let sku = rec.packagingType
              ? skus.find(s => s.name === rec.skuName && s.weight === rec.weight && (s as any).packagingType === rec.packagingType)
              : null;
            if (!sku) sku = skus.find(s => s.name === rec.skuName && s.weight === rec.weight);
            if (!sku) sku = skus.find(s => s.name === rec.skuName);
            if (!sku) continue;
            const value = rec.recommendedMastercases.toString();
            await db.upsertForecastData(sku.id, period.id, value);
            // Also write to IMS so it cascades to Planning FG
            await db.upsertImsData(sku.id, period.id, value, false);
            applied++;
          }
          totalApplied += applied;
          monthResults.push({ month, year, applied });
          await db.logAudit({
            username: ctx.user?.name || 'System',
            action: 'edit',
            country: typedCountry,
            sheet: 'Forecast',
            details: `Bulk applied AI forecast split for ${monthName} ${year} in ${typedCountry} — ${applied} SKUs updated (Forecast + IMS)`,
          });
        }
        return { success: true, totalApplied, monthResults };
      }),
  }),
});
export type AppRouter = typeof appRouter;
