import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Packer,
} from "docx";
import { storagePut } from "./storage";

interface ChangeEntry {
  username: string;
  action: string;
  sheet?: string | null;
  skuName?: string | null;
  periodLabel?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  details?: string | null;
  createdAt: Date | string;
}

interface ChangesSummary {
  totalChanges: number;
  bySheet: Record<string, number>;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
  recentChanges: ChangeEntry[];
  previousVersion: string | null;
  skuCount: number;
  periodCount: number;
}

interface Snapshot {
  skus: any[];
  periods: any[];
  forecast: any[];
  ims: any[];
  shipment: any[];
  arrival: any[];
  planningFg: any[];
}

function cellBorders() {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
  return { top: border, bottom: border, left: border, right: border };
}

function headerCell(text: string, width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: cellBorders(),
    shading: { fill: "2E7D32", color: "FFFFFF" },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20, font: "Calibri" })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

function dataCell(text: string, width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: cellBorders(),
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 18, font: "Calibri" })],
      }),
    ],
  });
}

export async function generateVersionDoc(
  versionName: string,
  description: string | undefined,
  changesSummary: ChangesSummary,
  snapshot: Snapshot
): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const sections: Paragraph[] = [];

  // Title
  sections.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "SSOF Planning System", bold: true, size: 36, font: "Calibri", color: "2E7D32" }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `Version: ${versionName}`, bold: true, size: 28, font: "Calibri" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `Generated: ${dateStr}`, italics: true, size: 20, font: "Calibri", color: "666666" }),
      ],
    }),
    new Paragraph({ children: [] }) // spacer
  );

  if (description) {
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Description", bold: true, size: 24, font: "Calibri" })],
      }),
      new Paragraph({
        children: [new TextRun({ text: description, size: 20, font: "Calibri" })],
      }),
      new Paragraph({ children: [] })
    );
  }

  // Overview section
  sections.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: "Version Overview", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
    })
  );

  const overviewTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [headerCell("Property", 40), headerCell("Value", 60)],
      }),
      new TableRow({ children: [dataCell("Version Name"), dataCell(versionName)] }),
      new TableRow({ children: [dataCell("Previous Version"), dataCell(changesSummary.previousVersion || "None (first version)")] }),
      new TableRow({ children: [dataCell("Total SKUs"), dataCell(String(changesSummary.skuCount))] }),
      new TableRow({ children: [dataCell("Total Periods"), dataCell(String(changesSummary.periodCount))] }),
      new TableRow({ children: [dataCell("Total Changes Since Last Version"), dataCell(String(changesSummary.totalChanges))] }),
    ],
  });
  sections.push(new Paragraph({ children: [] }));

  // SKU breakdown
  sections.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: "SKU Inventory", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
    })
  );

  const weights = ["1kg", "250g", "50g"];
  for (const w of weights) {
    const wSkus = snapshot.skus.filter((s: any) => s.weight === w);
    if (wSkus.length === 0) continue;
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: `${w} SKUs (${wSkus.length})`, bold: true, size: 22, font: "Calibri" })],
      })
    );
    const skuRows = [
      new TableRow({
        children: [headerCell("#", 10), headerCell("SKU Name", 50), headerCell("Category", 20), headerCell("Excluded", 20)],
      }),
    ];
    wSkus.forEach((s: any, i: number) => {
      skuRows.push(
        new TableRow({
          children: [
            dataCell(String(i + 1)),
            dataCell(s.name),
            dataCell(s.category || "Core"),
            dataCell(s.isExcludedFromTotal ? "Yes" : "No"),
          ],
        })
      );
    });
    sections.push(new Paragraph({ children: [] }));
    sections.push(new Paragraph({ children: [] })); // will add table after
  }

  // Changes by sheet
  if (changesSummary.totalChanges > 0) {
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Changes Summary", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
      })
    );

    // By sheet
    const sheetRows = [
      new TableRow({ children: [headerCell("Sheet", 60), headerCell("Changes", 40)] }),
    ];
    for (const [sheet, count] of Object.entries(changesSummary.bySheet)) {
      sheetRows.push(new TableRow({ children: [dataCell(sheet), dataCell(String(count))] }));
    }

    // By user
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: "Changes by User", bold: true, size: 22, font: "Calibri" })],
      })
    );
    const userRows = [
      new TableRow({ children: [headerCell("User", 60), headerCell("Changes", 40)] }),
    ];
    for (const [user, count] of Object.entries(changesSummary.byUser)) {
      userRows.push(new TableRow({ children: [dataCell(user), dataCell(String(count))] }));
    }

    // Recent changes detail
    if (changesSummary.recentChanges.length > 0) {
      sections.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: `Recent Changes (${Math.min(changesSummary.recentChanges.length, 50)} of ${changesSummary.totalChanges})`, bold: true, size: 22, font: "Calibri" })],
        })
      );
      const changeRows = [
        new TableRow({
          children: [
            headerCell("User", 15),
            headerCell("Action", 15),
            headerCell("Sheet", 15),
            headerCell("SKU", 20),
            headerCell("Details", 35),
          ],
        }),
      ];
      for (const c of changesSummary.recentChanges.slice(0, 50)) {
        changeRows.push(
          new TableRow({
            children: [
              dataCell(c.username),
              dataCell(c.action),
              dataCell(c.sheet || "-"),
              dataCell(c.skuName || "-"),
              dataCell(c.details || `${c.field || ""}: ${c.oldValue || ""} → ${c.newValue || ""}`),
            ],
          })
        );
      }
    }
  }

  // Build the document with tables inline
  const docChildren: (Paragraph | Table)[] = [...sections];

  // Insert tables at appropriate positions
  // We'll rebuild the document properly with all elements
  const allElements: (Paragraph | Table)[] = [];

  // Title block
  allElements.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: "SSOF Planning System", bold: true, size: 36, font: "Calibri", color: "2E7D32" })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: `Version Report: ${versionName}`, bold: true, size: 28, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: `Generated: ${dateStr}`, italics: true, size: 20, font: "Calibri", color: "666666" })],
    })
  );

  if (description) {
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: "Description", bold: true, size: 24, font: "Calibri" })],
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: description, size: 20, font: "Calibri" })],
      })
    );
  }

  // Overview
  allElements.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 100 },
      children: [new TextRun({ text: "Version Overview", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
    }),
    overviewTable
  );

  // SKU Inventory
  allElements.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 100 },
      children: [new TextRun({ text: "SKU Inventory", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
    })
  );

  for (const w of weights) {
    const wSkus = snapshot.skus.filter((s: any) => s.weight === w);
    if (wSkus.length === 0) continue;
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: `${w} SKUs (${wSkus.length})`, bold: true, size: 22, font: "Calibri" })],
      })
    );
    const skuTableRows = [
      new TableRow({
        children: [headerCell("#", 10), headerCell("SKU Name", 50), headerCell("Category", 20), headerCell("Excluded", 20)],
      }),
    ];
    wSkus.forEach((s: any, i: number) => {
      skuTableRows.push(
        new TableRow({
          children: [
            dataCell(String(i + 1)),
            dataCell(s.name),
            dataCell(s.category || "Core"),
            dataCell(s.isExcludedFromTotal ? "Yes" : "No"),
          ],
        })
      );
    });
    allElements.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: skuTableRows }));
  }

  // Changes
  if (changesSummary.totalChanges > 0) {
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
        children: [new TextRun({ text: "Changes Summary", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
      })
    );

    // By sheet table
    const sheetRows2 = [new TableRow({ children: [headerCell("Sheet", 60), headerCell("Changes", 40)] })];
    for (const [sheet, count] of Object.entries(changesSummary.bySheet)) {
      sheetRows2.push(new TableRow({ children: [dataCell(sheet), dataCell(String(count))] }));
    }
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: "Changes by Sheet", bold: true, size: 22, font: "Calibri" })],
      }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: sheetRows2 })
    );

    // By user table
    const userRows2 = [new TableRow({ children: [headerCell("User", 60), headerCell("Changes", 40)] })];
    for (const [user, count] of Object.entries(changesSummary.byUser)) {
      userRows2.push(new TableRow({ children: [dataCell(user), dataCell(String(count))] }));
    }
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: "Changes by User", bold: true, size: 22, font: "Calibri" })],
      }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: userRows2 })
    );

    // Recent changes
    if (changesSummary.recentChanges.length > 0) {
      const changeDetailRows = [
        new TableRow({
          children: [
            headerCell("User", 12),
            headerCell("Action", 12),
            headerCell("Sheet", 14),
            headerCell("SKU", 22),
            headerCell("Details", 40),
          ],
        }),
      ];
      for (const c of changesSummary.recentChanges.slice(0, 50)) {
        changeDetailRows.push(
          new TableRow({
            children: [
              dataCell(c.username || "-"),
              dataCell(c.action || "-"),
              dataCell(c.sheet || "-"),
              dataCell(c.skuName || "-"),
              dataCell(c.details || `${c.field || ""}: ${c.oldValue || ""} → ${c.newValue || ""}`),
            ],
          })
        );
      }
      allElements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: `Recent Changes (${Math.min(changesSummary.recentChanges.length, 50)} of ${changesSummary.totalChanges})`, bold: true, size: 22, font: "Calibri" })],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: changeDetailRows })
      );
    }
  } else {
    allElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
        children: [new TextRun({ text: "Changes Summary", bold: true, size: 24, font: "Calibri", color: "2E7D32" })],
      }),
      new Paragraph({
        children: [new TextRun({ text: "No changes recorded since the last version (or this is the first version).", italics: true, size: 20, font: "Calibri", color: "666666" })],
      })
    );
  }

  // Footer
  allElements.push(
    new Paragraph({ spacing: { before: 400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Al Fakher Lebanon — SSOF Planning System", italics: true, size: 18, font: "Calibri", color: "999999" }),
      ],
    })
  );

  const doc = new Document({
    sections: [{ children: allElements }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = versionName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileKey = `ssof-versions/${safeName}-${Date.now()}.docx`;
  const { url } = await storagePut(fileKey, Buffer.from(buffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  return url;
}
