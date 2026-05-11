import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useAppAuth } from "./AuthContext";
import type { Country as AuthCountry } from "./AuthContext";
import { clearDeniedCountry } from "@/lib/countryAccessStore";

export type Country = "Lebanon" | "Syria" | "Libya" | "KSA";

export const COUNTRY_CONFIG = {
  Lebanon: {
    label: "Lebanon",
    flag: "\u{1F1F1}\u{1F1E7}",
    color: "#dc2626",
    accentColor: "#16a34a",
    terms: {
      forecast: "Forecast",
      ims: "IMS",
      production: "Production (SHP)",
      arrival: "Arrival to Regie",
      forecastVsIms: "IMS vs Forecast",
      forecastProduction: null,
    },
    usesForecastVsIms: true,
    allowedUsers: ["walid", "taha", "david", "aileen", "viewer"],
    canManageSkus: false,
    usesExcelUpload: true,
  },
  Syria: {
    label: "Syria",
    flag: "\u{1F1F8}\u{1F1FE}",
    color: "#16a34a",
    accentColor: "#dc2626",
    terms: {
      forecast: "Forecast Production",
      ims: "IMS",
      production: "Production",
      arrival: "Arrival",
      forecastVsIms: "Forecast vs Actual",
      forecastProduction: "Forecast Production",
    },
    usesForecastVsIms: false,
    allowedUsers: ["walid", "syriaadmin", "syriaviewer"],
    canManageSkus: true,
    usesExcelUpload: false,
  },
  Libya: {
    label: "Libya",
    flag: "\u{1F1F1}\u{1F1FE}",
    color: "#1d4ed8",
    accentColor: "#d97706",
    terms: {
      forecast: "Forecast Production",
      ims: "IMS",
      production: "Production",
      arrival: "Arrival",
      forecastVsIms: "Forecast vs Actual",
      forecastProduction: "Forecast Production",
    },
    usesForecastVsIms: false,
    allowedUsers: ["walid", "libyadmin", "libyaviewer"],
    canManageSkus: true,
    usesExcelUpload: false,
  },
  KSA: {
    label: "KSA",
    flag: "\u{1F1F8}\u{1F1E6}",
    color: "#15803d",
    accentColor: "#0f766e",
    terms: {
      forecast: "Forecast Production",
      ims: "IMS",
      production: "Production",
      arrival: "Arrival",
      forecastVsIms: "Forecast vs Actual",
      forecastProduction: "Forecast Production",
    },
    usesForecastVsIms: false,
    allowedUsers: ["walid", "ksaadmin", "ksaviewer"],
    canManageSkus: true,
    usesExcelUpload: false,
  },
} as const;

interface CountryContextValue {
  country: Country | null;
  setCountry: (c: Country) => void;
  clearCountry: () => void;
  config: typeof COUNTRY_CONFIG[Country] | null;
}

const CountryContext = createContext<CountryContextValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const auth = useAppAuth();

  const country = (auth.country as Country) ?? null;

  const setCountry = useCallback((c: Country) => {
    // Picking a (different) country invalidates any prior server-side
    // FORBIDDEN denial — the user's about to fire fresh queries that will
    // re-confirm or re-deny.
    clearDeniedCountry();
    auth.setCountry(c as AuthCountry);
  }, [auth]);

  const clearCountry = useCallback(() => {
    clearDeniedCountry();
    auth.clearCountry();
  }, [auth]);

  return (
    <CountryContext.Provider value={{
      country,
      setCountry,
      clearCountry,
      config: country ? COUNTRY_CONFIG[country] : null,
    }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error("useCountry must be used within CountryProvider");
  return ctx;
}
