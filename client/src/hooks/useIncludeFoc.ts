import { useCallback, useEffect, useState } from "react";
import type { FocCountry } from "@shared/performance/foc";

const keyFor = (country: FocCountry) => `ssof:include-foc:${country}`;
const read = (country: FocCountry) => {
  try { return localStorage.getItem(keyFor(country)) !== "false"; } catch { return true; }
};

/** One country-scoped switch shared by planning, FOC and performance screens. */
export function useIncludeFoc(country: FocCountry) {
  const [stored, setStored] = useState(() => ({ country, value: read(country) }));
  const includeFoc = stored.country === country ? stored.value : read(country);

  useEffect(() => {
    setStored({ country, value: read(country) });
    const onStorage = (event: StorageEvent) => {
      if (event.key === keyFor(country)) setStored({ country, value: event.newValue !== "false" });
    };
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<{ country: string; value: boolean }>).detail?.country === country)
        setStored({ country, value: (event as CustomEvent<{ value: boolean }>).detail.value });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("ssof-include-foc", onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ssof-include-foc", onLocalChange);
    };
  }, [country]);

  const setIncludeFoc = useCallback((value: boolean) => {
    setStored({ country, value });
    try { localStorage.setItem(keyFor(country), String(value)); } catch {}
    window.dispatchEvent(new CustomEvent("ssof-include-foc", { detail: { country, value } }));
  }, [country]);

  return { includeFoc, setIncludeFoc };
}
