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
 *   ArrowRight / Tab           → save + next cell in list
 *   ArrowLeft  / Shift+Tab     → save + previous cell in list
 *   ArrowDown                  → save + cell in same column, next row (falls back to idx+1)
 *   ArrowUp                    → save + cell in same column, previous row (falls back to idx-1)
 *   Enter                      → save + next cell (idx+1), or just save if at end
 *   Escape                     → cancel without saving
 */

import { useCallback } from "react";

interface UseGridNavOptions {
  cellIds: string[];
  editingCell: string | null;
  setEditingCell: (id: string | null) => void;
  onSave: (cellId: string) => void;
  onCancel: () => void;
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

      // Always save first, then navigate to target (or close editor if no valid target).
      const saveAndMove = (targetIdx: number) => {
        onSave(cellId);
        if (targetIdx >= 0 && targetIdx < cellIds.length) {
          setEditingCell(cellIds[targetIdx]);
        } else {
          setEditingCell(null);
        }
      };

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          saveAndMove(idx + 1);
          break;

        case "ArrowLeft":
          e.preventDefault();
          saveAndMove(idx - 1);
          break;

        case "ArrowDown":
          e.preventDefault();
          if (colCount && colCount > 0) {
            saveAndMove(idx + colCount);
          } else {
            saveAndMove(idx + 1);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (colCount && colCount > 0) {
            saveAndMove(idx - colCount);
          } else {
            saveAndMove(idx - 1);
          }
          break;

        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            saveAndMove(idx - 1);
          } else {
            saveAndMove(idx + 1);
          }
          break;

        case "Enter":
          e.preventDefault();
          // Enter: save and move to the next cell in the list (idx+1).
          // Using idx+1 (not colCount) because rows may have different numbers
          // of editable cells, making colCount-based jumps unreliable.
          saveAndMove(idx + 1);
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
