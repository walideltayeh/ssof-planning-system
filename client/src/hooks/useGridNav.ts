/**
 * useGridNav — shared keyboard navigation hook for all SSOF data tables.
 *
 * Usage:
 *   const { handleNavKeyDown } = useGridNav({
 *     cellIds,          // ordered flat list of all navigable cell IDs (e.g. "skuId-periodId")
 *     editingCell,      // currently active cell ID
 *     setEditingCell,   // setter to open a cell
 *     onSave,           // called with the current cellId when Enter / Tab / Arrow is pressed to commit
 *     onCancel,         // called when Escape is pressed
 *   });
 *
 * Then in each cell's input:
 *   onKeyDown={e => handleNavKeyDown(e, cellId)}
 *
 * Navigation rules:
 *   ArrowRight / Tab           → next cell in list (wraps to next row)
 *   ArrowLeft  / Shift+Tab     → previous cell in list
 *   ArrowDown                  → cell in same column, next row
 *   ArrowUp                    → cell in same column, previous row
 *   Enter                      → save + move to next cell (same as ArrowRight)
 *   Escape                     → cancel without saving
 */

import { useCallback } from "react";

interface UseGridNavOptions {
  /** Flat ordered list of all navigable cell IDs in reading order (left→right, top→bottom). */
  cellIds: string[];
  editingCell: string | null;
  setEditingCell: (id: string | null) => void;
  /** Called with the current cell ID to commit the current edit value before moving. */
  onSave: (cellId: string) => void;
  /** Called when Escape is pressed — should cancel the edit without saving. */
  onCancel: () => void;
  /**
   * Number of columns in the grid (i.e. how many cells per row).
   * Used to compute ArrowUp/ArrowDown jumps.
   * If omitted, Up/Down behave like Left/Right (sequential).
   */
  colCount?: number;
}

export function useGridNav({
  cellIds,
  editingCell,
  setEditingCell,
  onSave,
  onCancel,
  colCount,
}: UseGridNavOptions) {
  const handleNavKeyDown = useCallback(
    (e: React.KeyboardEvent, cellId: string) => {
      const idx = cellIds.indexOf(cellId);

      const moveToIndex = (targetIdx: number) => {
        if (targetIdx < 0 || targetIdx >= cellIds.length) return;
        // Save current cell first
        onSave(cellId);
        // Open the target cell
        setEditingCell(cellIds[targetIdx]);
      };

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          moveToIndex(idx + 1);
          break;

        case "ArrowLeft":
          e.preventDefault();
          moveToIndex(idx - 1);
          break;

        case "ArrowDown":
          e.preventDefault();
          if (colCount && colCount > 0) {
            moveToIndex(idx + colCount);
          } else {
            moveToIndex(idx + 1);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (colCount && colCount > 0) {
            moveToIndex(idx - colCount);
          } else {
            moveToIndex(idx - 1);
          }
          break;

        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            moveToIndex(idx - 1);
          } else {
            moveToIndex(idx + 1);
          }
          break;

        case "Enter":
          e.preventDefault();
          // Enter saves and moves down (like Excel default)
          if (colCount && colCount > 0) {
            moveToIndex(idx + colCount);
          } else {
            moveToIndex(idx + 1);
          }
          break;

        case "Escape":
          e.preventDefault();
          onCancel();
          break;

        default:
          break;
      }
    },
    [cellIds, onSave, onCancel, setEditingCell, colCount]
  );

  return { handleNavKeyDown };
}
