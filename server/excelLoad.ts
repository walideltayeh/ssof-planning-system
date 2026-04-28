import type ExcelJS from "exceljs";

/**
 * Compatibility shim for `ExcelJS.Workbook.xlsx.load`.
 *
 * The bundled `exceljs` type definitions declare `load(data: Buffer)` against
 * the legacy non-generic `Buffer` type, but the project's `@types/node` now
 * resolves `Buffer` to the generic `Buffer<ArrayBufferLike>`. The two are the
 * same object at runtime, so this helper re-types the load function to accept
 * any `Uint8Array` (which both `Buffer` flavors structurally satisfy) and
 * centralizes the single cast needed to bridge the declaration mismatch.
 *
 * Remove this shim once `exceljs`'s types are updated to align with the
 * current `@types/node` `Buffer` declaration.
 */
type XlsxLoad = (data: Uint8Array) => Promise<ExcelJS.Workbook>;

export async function loadXlsxBuffer(
  wb: ExcelJS.Workbook,
  buffer: Uint8Array,
): Promise<void> {
  await (wb.xlsx.load as unknown as XlsxLoad)(buffer);
}
