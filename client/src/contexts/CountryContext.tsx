import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Country = "Lebanon" | "Syria" | "Libya";

export const COUNTRY_CONFIG = {
  Lebanon: {
    label: "Lebanon",
    flag: "🇱🇧",
    color: "#dc2626", // red
    accentColor: "#16a34a", // green
    // Terminology
    terms: {
      forecast: "Forecast",
      ims: "IMS",
      production: "Production (SHP)",
      arrival: "Arrival to Regie",
      forecastVsIms: "IMS vs Forecast",
      forecastProduction: null, // not used
    },
    // Flow: Forecast → IMS comparison
    usesForecastVsIms: true,
    // Users who can access this country
    allowedUsers: ["walid", "taha", "david", "aileen", "viewer"],
    // Can manage SKUs
    canManageSkus: false,
    // Uses Excel upload
    usesExcelUpload: true,
  },
  Syria: {
    label: "Syria",
    flag: "🇸🇾",
    color: "#16a34a", // green
    accentColor: "#dc2626",
    terms: {
      forecast: "Forecast Production",
      ims: "IMS",
      production: "Production",
      arrival: "Arrival",
      forecastVsIms: "Forecast vs Forecast",
      forecastProduction: "Forecast Production",
    },
    usesForecastVsIms: false, // uses Forecast vs Forecast instead
    allowedUsers: ["walid", "syriaadmin", "syriaviewer"],
    canManageSkus: true,
    usesExcelUpload: false,
  },
  Libya: {
    label: "Libya",
    flag: "🇱🇾",
    color: "#1d4ed8", // blue
    accentColor: "#d97706",
    terms: {
      forecast: "Forecast Production",
      ims: "IMS",
      production: "Production",
      arrival: "Arrival",
      forecastVsIms: "Forecast vs Forecast",
      forecastProduction: "Forecast Production",
    },
    usesForecastVsIms: false,
    allowedUsers: ["walid", "libyadmin", "libyaviewer"],
    canManageSkus: true,
    usesExcelUpload: false,
  },
} as const;

const COUNTRY_STORAGE_KEY = "ssof-country";

interface CountryContextValue {
  country: Country | null;
  setCountry: (c: Country) => void;
  clearCountry: () => void;
  config: typeof COUNTRY_CONFIG[Country] | null;
}

const CountryContext = createContext<CountryContextValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<Country | null>(() => {
    const stored = sessionStorage.getItem(COUNTRY_STORAGE_KEY);
    if (stored === "Lebanon" || stored === "Syria" || stored === "Libya") return stored;
    return null;
  });

  const setCountry = useCallback((c: Country) => {
    sessionStorage.setItem(COUNTRY_STORAGE_KEY, c);
    setCountryState(c);
  }, []);

  const clearCountry = useCallback(() => {
    sessionStorage.removeItem(COUNTRY_STORAGE_KEY);
    setCountryState(null);
  }, []);

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
