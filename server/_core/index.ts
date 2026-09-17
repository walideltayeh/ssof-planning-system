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
import { authenticateHttpRequest } from "./httpAuth";
import { registerSpreadsheetUploadRoutes } from "./spreadsheetUploadRoutes";

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
      if (!(await authenticateHttpRequest(req, res))) return;
      const country = req.query.country as string | undefined;
      let buffer: Buffer;
      let countryLabel = "Lebanon";
      if (country === "Syria" || country === "Libya" || country === "KSA" || country === "KSA") {
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
  app.get("/api/export-sheet", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
      const sheet = req.query.sheet as string;
      const country = req.query.country as string | undefined;
      if (!sheet) {
        res.status(400).json({ error: "Missing 'sheet' query parameter" });
        return;
      }
      let buffer: Buffer;
      let countryLabel = "Lebanon";
      if (country === "Syria" || country === "Libya" || country === "KSA" || country === "KSA") {
        const { generateSingleSheetBufferForCountry } = await import("../excelExport");
        buffer = await generateSingleSheetBufferForCountry(country, sheet);
        countryLabel = country;
      } else {
        const { generateSingleSheetBuffer } = await import("../excelExport");
        buffer = await generateSingleSheetBuffer(sheet);
      }
      const sheetLabel = sheet.replace(/-/g, "_");
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=SSOF_${countryLabel}_${sheetLabel}_${dateStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Sheet Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  app.get("/api/export-analysis", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
      const { generateAnalysisExcelBuffer } = await import("../excelExport");
      const buffer = await generateAnalysisExcelBuffer();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=SSOF_Analysis_${dateStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Analysis Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  app.get("/api/export-intl-analysis", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
      const country = req.query.country as string;
      if (country !== "Syria" && country !== "Libya" && country !== "KSA" && country !== "KSA") {
        return res.status(400).json({ error: "Country must be Syria, Libya, or KSA" });
      }
      const { generateIntlAnalysisExcelBuffer } = await import("../excelExport");
      const buffer = await generateIntlAnalysisExcelBuffer(country);
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=SSOF_${country}_Analysis_${dateStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Intl Analysis Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // Country Performance board pack (one sheet per section). Country access is
  // enforced here because this bypasses the tRPC requireCountryAccess guard.
  app.get("/api/export-performance", async (req, res) => {
    try {
      const auth = await authenticateHttpRequest(req, res);
      if (!auth) return;
      const { parsePerformanceExportQuery, userMayAccessCountry } = await import("../analysis/countryPerformanceExport");
      const parsed = parsePerformanceExportQuery(req.query as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (!(await userMayAccessCountry(auth.user.name ?? null, parsed.request.country))) {
        res.status(403).json({ error: `You do not have access to ${parsed.request.country}` });
        return;
      }
      const { getCountryPerformance } = await import("../analysis/countryPerformance");
      const { buildPerformanceWorkbook } = await import("../analysis/countryPerformanceExcel");
      const pack = await getCountryPerformance(parsed.request);
      const buffer = await buildPerformanceWorkbook(pack);
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=SSOF_${parsed.request.country}_Country_Performance_${dateStr}.xlsx`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Performance Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  app.get("/api/export-ims-template", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
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
      if (!(await authenticateHttpRequest(req, res))) return;
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
  // Competitor Analysis template export
  app.get("/api/export-competitor-template", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
      const country = (req.query.country as string) || "Lebanon";
      const ExcelJS = (await import("exceljs")).default;
      const { getCompetitorData } = await import("../db");
      const existing = await getCompetitorData(country);

      const defaultBrandMonthly: Record<string, Record<number, number[]>> = {
        "Al Fakher": {
          2022: [3167,8275,25322,6738,15562,10186,13723,11114,12553,8237,17052,21910],
          2023: [7838,8056,11517,11788,11098,7417,18465,16261,21857,17279,12209,13698],
          2024: [11471,13550,11283,8056,10171,15808,18022,13534,10188,21931,11789,11546],
          2025: [14784,10218,21235,22196,1554,10767,14935,17847,23853,24612,23101,11888],
          2026: [21751,12477,21187,0,0,0,0,0,0,0,0,0],
        },
        "Mazaya": {
          2022: [14686,20115,17290,19336,22667,22621,26991,37505,26541,6296,8115,7464],
          2023: [7587,2809,14256,16710,14485,10904,15866,22133,26295,23780,21309,12218],
          2024: [13979,16247,11755,16646,17597,21641,32187,27747,21005,21859,15474,8532],
          2025: [23723,21545,19765,24907,23695,22001,34080,28975,31782,31782,15744,22969],
          2026: [38552,22380,23838,0,0,0,0,0,0,0,0,0],
        },
        "Nakhla": {
          2022: [3373,13442,23325,7907,0,6156,20960,27286,14738,11468,10735,3021],
          2023: [35127,12055,26878,14687,16711,9819,20684,14070,8655,19160,22175,8077],
          2024: [31319,24844,18212,12762,19578,20911,31384,23715,14954,16677,7632,4117],
          2025: [46585,17017,18897,28293,26491,17064,26029,24662,20865,14704,16556,11465],
          2026: [59330,22688,25397,0,0,0,0,0,0,0,0,0],
        },
        "Others": {
          2022: [4354,9828,1881,2379,7000,5897,5148,9444,5141,585,1426,1172],
          2023: [774,7910,1114,524,337,1033,285,0,709,1325,480,998],
          2024: [2084,308,1132,389,290,616,1941,2925,1287,3102,1589,9295],
          2025: [662,3191,2586,4193,2907,5505,3050,3055,3353,4596,885,6793],
          2026: [4523,4132,6490,0,0,0,0,0,0,0,0,0],
        },
      };

      const defaultFlavorYearly: Record<string, Record<string, Record<number, number>>> = {
        "Al Fakher": {
          "Two Apple": {2020:9624,2021:90212,2022:120230,2023:124885,2024:128963,2025:159291,2026:49308},
          "Grapes": {2020:1893,2021:7923,2022:9113,2023:8384,2024:7284,2025:12307,2026:1820},
          "Lemon Mint": {2020:2715,2021:5188,2022:8503,2023:7483,2024:6570,2025:8231,2026:1601},
          "Mint": {2020:1599,2021:7177,2022:7068,2023:5633,2024:4948,2025:8541,2026:1007},
          "Grape Mint": {2020:797,2021:5416,2022:0,2023:8349,2024:4677,2025:6488,2026:1215},
          "Gum": {2020:213,2021:1767,2022:1974,2023:991,2024:543,2025:990,2026:276},
          "Other Flavors": {2020:530,2021:2784,2022:3077,2023:1758,2024:4364,2025:1142,2026:188},
        },
        "Mazaya": {
          "Two Apple": {2020:5857,2021:82459,2022:90732,2023:58134,2024:117337,2025:84203,2026:25073},
          "Lemon Mint": {2020:40528,2021:119214,2022:90100,2023:92428,2024:70252,2025:176984,2026:48854},
          "Gum": {2020:1478,2021:15419,2022:17168,2023:8450,2024:12592,2025:11027,2026:3708},
          "Mint": {2020:1484,2021:8471,2022:6680,2023:5724,2024:6639,2025:7184,2026:1680},
          "Grapes": {2020:864,2021:4353,2022:5289,2023:4243,2024:4202,2025:5592,2026:837},
          "Grape Mint": {2020:1045,2021:4835,2022:0,2023:4614,2024:5165,2025:5942,2026:1052},
          "Other Flavors": {2020:1548,2021:7442,2022:14119,2023:14759,2024:8482,2025:10036,2026:3566},
        },
        "Nakhla": {
          "Two Apple": {2020:148654,2021:152000,2022:140289,2023:207312,2024:224025,2025:265905,2026:107415},
          "Lemon Mint": {2020:0,2021:0,2022:0,2023:0,2024:966,2025:2723,2026:0},
          "Grapes": {2020:115,2021:39,2022:366,2023:20,2024:251,2025:0,2026:0},
          "Other Flavors": {2020:839,2021:1110,2022:1732,2023:766,2024:863,2025:0,2026:0},
        },
        "Khalil Maamoun": {
          "Two Apple": {2020:3756,2021:40533,2022:37768,2023:2242,2024:9136,2025:16275,2026:3460},
        },
        "Al Basha": {
          "Two Apple": {2020:0,2021:0,2022:1584,2023:3233,2024:2799,2025:4705,2026:2070},
          "Lemon Mint": {2020:0,2021:0,2022:0,2023:1189,2024:1168,2025:1166,2026:404},
        },
        "Gold Dahab": {
          "Two Apple": {2020:0,2021:0,2022:0,2023:0,2024:1653,2025:5895,2026:2843},
        },
        "Mawal": {
          "Two Apple": {2020:0,2021:0,2022:0,2023:0,2024:4448,2025:5593,2026:1401},
          "Lemon Mint": {2020:0,2021:0,2022:0,2023:0,2024:1144,2025:775,2026:225},
        },
      };

      const brandMonthly = (existing?.brandMonthly as any) || (country === "Lebanon" ? defaultBrandMonthly : {});
      const flavorYearly = (existing?.flavorYearly as any) || (country === "Lebanon" ? defaultFlavorYearly : {});

      const wb = new ExcelJS.Workbook();

      const ws1 = wb.addWorksheet("Brand Monthly Sales");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const h1 = ws1.addRow(["Brand", "Year", ...months]);
      h1.font = { bold: true };
      h1.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } }; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
      for (const [brand, years] of Object.entries(brandMonthly as Record<string, Record<string, number[]>>)) {
        for (const [year, vals] of Object.entries(years)) {
          ws1.addRow([brand, parseInt(year), ...(vals as number[])]);
        }
      }
      ws1.addRow([]);
      const instrRow1 = ws1.addRow(["Instructions: Add or modify rows. Brand + Year identify each row. Values are in Mastercases (MC)."]);
      instrRow1.font = { italic: true, color: { argb: "FF666666" } };
      const instrRow1b = ws1.addRow(["Add new brands by entering the brand name in column A and year in column B."]);
      instrRow1b.font = { italic: true, color: { argb: "FF666666" } };
      ws1.getColumn(1).width = 22;
      ws1.getColumn(2).width = 8;
      for (let i = 3; i <= 14; i++) ws1.getColumn(i).width = 10;

      const ws2 = wb.addWorksheet("Brand Flavor Annual");
      const flavorYears = [2020,2021,2022,2023,2024,2025,2026];
      const h2 = ws2.addRow(["Brand", "Flavor", ...flavorYears]);
      h2.font = { bold: true };
      h2.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } }; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
      for (const [brand, flavors] of Object.entries(flavorYearly as Record<string, Record<string, Record<string, number>>>)) {
        for (const [flavor, years] of Object.entries(flavors)) {
          ws2.addRow([brand, flavor, ...flavorYears.map(y => (years as any)[y] ?? 0)]);
        }
      }
      ws2.addRow([]);
      const instrRow2 = ws2.addRow(["Instructions: Add or modify rows. Brand + Flavor identify each row. Values are in Mastercases (MC)."]);
      instrRow2.font = { italic: true, color: { argb: "FF666666" } };
      const instrRow2b = ws2.addRow(["Add new brands/flavors by entering them in columns A and B. Use consistent names."]);
      instrRow2b.font = { italic: true, color: { argb: "FF666666" } };
      ws2.getColumn(1).width = 22;
      ws2.getColumn(2).width = 18;
      for (let i = 3; i <= 9; i++) ws2.getColumn(i).width = 10;

      const buffer = await wb.xlsx.writeBuffer();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Competitor_Template_${country}_${dateStr}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("[Competitor Template Export] Error:", err);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // Spreadsheet upload endpoints (`/api/import-sheet` + `/api/import-competitor`).
  // Extracted to a separate module so the auth/audit-username behaviour is
  // covered by `server/spreadsheetUpload.test.ts`.
  registerSpreadsheetUploadRoutes(app);

  // Multi-month forecast split Excel export endpoint
  app.post("/api/export-forecast-split-multi", async (req, res) => {
    try {
      if (!(await authenticateHttpRequest(req, res))) return;
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
      if (!(await authenticateHttpRequest(req, res))) return;
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
  
  const { ensureDataIndexes, getOrCreateJwtSecret } = await import("../db");
  await ensureDataIndexes();

  // Provision the JWT signing secret used by AppUser session cookies. We store
  // it in `app_settings` (not `.replit` userenv, which would commit it to the
  // repo, and not env-vars, which the platform exposes via listings) and
  // override it onto the SDK at boot. If JWT_SECRET is set in the real env,
  // sdk.getSessionSecret prefers it and this DB value is ignored — but having
  // it always provisioned means username/password logins work out of the box.
  //
  // Fail-fast: if neither the env var nor a DB-loaded secret is available,
  // every login would silently produce zero-length-key crashes (the exact
  // class of outage we are fixing), so we abort startup instead of logging
  // and serving traffic with broken auth.
  try {
    const persistedSecret = await getOrCreateJwtSecret();
    const { sdk } = await import("./sdk");
    sdk.setRuntimeSessionSecret(persistedSecret);
  } catch (err) {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length > 0) {
      console.error("[Auth] Failed to provision DB session secret; continuing with env JWT_SECRET:", err);
    } else {
      console.error("[Auth] Failed to provision session secret and no JWT_SECRET env var set. Aborting startup to avoid serving with broken auth.", err);
      throw err;
    }
  }

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
