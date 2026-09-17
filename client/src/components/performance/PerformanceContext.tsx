/**
 * Page-level context for the board pack: who may edit (country admins), which
 * period the presenter notes belong to, and the notes themselves (fetched once
 * per country + period and shared by every section).
 */
import { createContext, useContext, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import type { PerformanceCountry } from "./types";

export interface PresenterNoteRecord {
  sectionId: string;
  body: string;
  author: string;
  updatedAt: string;
}

interface PerformanceContextValue {
  country: PerformanceCountry;
  periodKey: string;
  canEdit: boolean;
  notes: PresenterNoteRecord[];
  noteFor: (sectionId: string) => PresenterNoteRecord | undefined;
}

const PerformanceContext = createContext<PerformanceContextValue | null>(null);

export function PerformanceProvider({ country, periodKey, canEdit, children }: { country: PerformanceCountry; periodKey: string | null; canEdit: boolean; children: ReactNode }) {
  const notesQuery = trpc.country.presenterNotes.useQuery({ country, periodKey: periodKey ?? "" }, { enabled: periodKey !== null, placeholderData: (previous) => previous });
  const notes = periodKey === null ? [] : notesQuery.data ?? [];
  const value: PerformanceContextValue = {
    country,
    periodKey: periodKey ?? "",
    canEdit,
    notes,
    noteFor: (sectionId) => notes.find((note) => note.sectionId === sectionId),
  };
  return <PerformanceContext.Provider value={value}>{children}</PerformanceContext.Provider>;
}

export function usePerformanceContext(): PerformanceContextValue | null {
  return useContext(PerformanceContext);
}
