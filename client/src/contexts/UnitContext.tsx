import { createContext, useContext, useState, ReactNode } from "react";

export type UnitType = "MC" | "KG" | "Tons";

const MC_TO_KG = 6;
const MC_TO_TONS = 0.006;

interface UnitContextType {
  unit: UnitType;
  setUnit: (u: UnitType) => void;
  convertVal: (mcValue: number) => number;
  formatVal: (mcValue: number, decimals?: number) => string;
  unitLabel: string;
}

const UnitContext = createContext<UnitContextType>({
  unit: "MC",
  setUnit: () => {},
  convertVal: (v) => v,
  formatVal: (v) => v.toLocaleString("en-US"),
  unitLabel: "MC",
});

export function UnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnit] = useState<UnitType>(() => {
    const saved = localStorage.getItem("ssof-unit");
    return (saved === "KG" || saved === "Tons") ? saved : "MC";
  });

  const handleSetUnit = (u: UnitType) => {
    setUnit(u);
    localStorage.setItem("ssof-unit", u);
  };

  const convertVal = (mcValue: number): number => {
    if (unit === "KG") return mcValue * MC_TO_KG;
    if (unit === "Tons") return mcValue * MC_TO_TONS;
    return mcValue;
  };

  const formatVal = (mcValue: number, decimals?: number): string => {
    if (mcValue === 0) return "0";
    const converted = convertVal(mcValue);
    if (unit === "Tons") {
      const d = decimals ?? 2;
      return converted.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    const d = decimals ?? 0;
    return converted.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  return (
    <UnitContext.Provider value={{ unit, setUnit: handleSetUnit, convertVal, formatVal, unitLabel: unit }}>
      {children}
    </UnitContext.Provider>
  );
}

export function useUnit() {
  return useContext(UnitContext);
}
