import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { runStartupMigration } from "../startup-migration";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Excel export endpoint (server-side with ExcelJS for live formulas)
  app.get("/api/export-excel", async (req, res) => {
    try {
      const country = req.query.country as string | undefined;
      let buffer: Buffer;
      let countryLabel = "Lebanon";
      if (country === "Syria" || country === "Libya") {
        const { generateExcelBufferForCountry } = await import("../excelExport");
        buffer = await generateExcelBufferForCountry(country);
        countryLabel = country;
      } else {
        const { generateExcelBuffer } = await import("../excelExport");
        buffer = await generateExcelBuffer();
      }
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=SSOF_Planning_${countryLabel}_${dateStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Excel Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });
  app.get("/api/export-ims-template", async (req, res) => {
    try {
      const country = (req.query.country as string) || "Lebanon";
      const { getSkusForCountry, getPeriodsForCountry, getImsDataForCountry } = await import("../db");
      const ExcelJS = (await import("exceljs")).default;
      const skus = await getSkusForCountry(country as any);
      const periods = await getPeriodsForCountry(country as any);
      const existingIms = await getImsDataForCountry(country as any);
      const imsMap = new Map<string, string>();
      for (const row of existingIms) {
        imsMap.set(`${row.skuId}-${row.periodId}`, row.value ?? "0");
      }
      const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("IMS vs FRCST");
      const headerRow = ["SKU Name", ...sortedPeriods.map(p => p.label)];
      const hRow = ws.addRow(headerRow);
      hRow.font = { bold: true };
      hRow.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } }; });
      for (const sku of skus) {
        const vals = sortedPeriods.map(p => {
          const v = parseFloat(imsMap.get(`${sku.id}-${p.id}`) ?? "0");
          return v || "";
        });
        ws.addRow([sku.name, ...vals]);
      }
      ws.getColumn(1).width = 30;
      for (let i = 2; i <= sortedPeriods.length + 1; i++) ws.getColumn(i).width = 12;
      const buffer = await wb.xlsx.writeBuffer();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=IMS_Template_${country}_${dateStr}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("[IMS Template Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // Forecast split Excel export endpoint
  app.post("/api/export-forecast-split", async (req, res) => {
    try {
      const { generateForecastSplitExcel } = await import("../forecastSplitExcel");
      const buffer = await generateForecastSplitExcel(req.body);
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthStr = monthNames[(req.body.targetMonth ?? 1) - 1] ?? "Month";
      const yearStr = req.body.targetYear ?? new Date().getFullYear();
      const country = req.body.country ?? "Country";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Forecast_Split_${country}_${monthStr}_${yearStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Forecast Split Excel] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });
  // Multi-month forecast split Excel export endpoint
  app.post("/api/export-forecast-split-multi", async (req, res) => {
    try {
      const { generateMultiMonthForecastSplitExcel } = await import("../forecastSplitExcelMulti");
      const buffer = await generateMultiMonthForecastSplitExcel(req.body);
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const startStr = monthNames[(req.body.startMonth ?? 1) - 1] ?? "Month";
      const yearStr = req.body.startYear ?? new Date().getFullYear();
      const country = req.body.country ?? "Country";
      const duration = req.body.duration ?? 1;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Forecast_Split_${country}_${duration}M_from_${startStr}_${yearStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Multi-Month Forecast Split Excel] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // Forecast split Excel upload endpoint — parses uploaded (modified) Excel and returns structured SKU rows
  app.post("/api/upload-forecast-split", async (req, res) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
      await new Promise<void>((resolve, reject) => {
        upload.single("file")(req as any, res as any, (err: any) => {
          if (err) reject(err); else resolve();
        });
      });
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const { parseForecastSplitExcel } = await import("../forecastSplitExcelParser");
      const result = await parseForecastSplitExcel(file.buffer);
      res.json({ success: true, result });
    } catch (err: any) {
      console.error("[Forecast Upload] Error:", err);
      res.status(400).json({ error: err?.message || "Failed to parse uploaded file" });
    }
  });

  // Temporary full-database export endpoint (for data migration)
  app.get("/api/export-db", async (req, res) => {
    try {
      const db = await import("../db");
      const [lebanon, syria, libya, syriaEvents, libyaEvents, lebaEvents, versions] = await Promise.all([
        db.getFullSnapshot("Lebanon"),
        db.getFullSnapshot("Syria"),
        db.getFullSnapshot("Libya"),
        db.getClearanceEventsForCountry("Syria"),
        db.getClearanceEventsForCountry("Libya"),
        db.getClearanceEventsForCountry("Lebanon"),
        Promise.all([
          db.listVersions("Lebanon"),
          db.listVersions("Syria"),
          db.listVersions("Libya"),
        ]),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        snapshots: { Lebanon: lebanon, Syria: syria, Libya: libya },
        clearanceEvents: { Lebanon: lebaEvents, Syria: syriaEvents, Libya: libyaEvents },
        versions: {
          Lebanon: versions[0],
          Syria: versions[1],
          Libya: versions[2],
        },
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename=ssof-full-export-${Date.now()}.json`);
      res.json(payload);
    } catch (err: any) {
      console.error("[DB Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // Temporary full-database import endpoint (for data migration)
  app.post("/api/import-db", async (req, res) => {
    try {
      const db = await import("../db");
      const payload = req.body;
      if (!payload?.snapshots) {
        res.status(400).json({ error: "Invalid payload: missing snapshots" });
        return;
      }
      const countries = ["Lebanon", "Syria", "Libya"] as const;
      const results: Record<string, string> = {};

      // Merge all country snapshots into one combined snapshot, then do a single
      // global restore (clears everything first to avoid PK conflicts).
      const combined: any = { skus: [], periods: [], forecast: [], ims: [], shipment: [], arrival: [], planningFg: [] };
      for (const country of countries) {
        const snap = payload.snapshots[country];
        if (snap) {
          combined.skus.push(...(snap.skus ?? []));
          combined.periods.push(...(snap.periods ?? []));
          combined.forecast.push(...(snap.forecast ?? []));
          combined.ims.push(...(snap.ims ?? []));
          combined.shipment.push(...(snap.shipment ?? []));
          combined.arrival.push(...(snap.arrival ?? []));
          combined.planningFg.push(...(snap.planningFg ?? []));
          results[country] = `${(snap.skus ?? []).length} skus`;
        } else {
          results[country] = "no data";
        }
      }
      // Global restore: clears all tables first, then inserts combined data
      await db.restoreSnapshot(combined);

      // Import clearance events if present
      if (payload.clearanceEvents) {
        for (const country of countries) {
          const events = payload.clearanceEvents[country];
          if (!events?.length) continue;
          for (const ev of events) {
            try {
              await db.importClearanceEvent(ev);
            } catch (e: any) {
              console.warn(`[Import] clearance event ${ev.id} skip: ${e.message}`);
            }
          }
          results[`clearanceEvents_${country}`] = `${events.length} events`;
        }
      }
      res.json({ success: true, results });
    } catch (err: any) {
      console.error("[DB Import] Error:", err);
      res.status(500).json({ error: err?.message || "Import failed" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Run startup migration (seeds DB from seed-data.json if empty)
  await runStartupMigration();
  
  const { ensureDataIndexes } = await import("../db");
  await ensureDataIndexes();

  const preferredPort = parseInt(process.env.PORT || "5000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
