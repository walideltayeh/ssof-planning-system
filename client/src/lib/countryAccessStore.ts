import { useSyncExternalStore } from "react";

let deniedCountry: string | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach(l => l());
};

export function setDeniedCountry(country: string | null): void {
  if (deniedCountry === country) return;
  deniedCountry = country;
  notify();
}

export function getDeniedCountry(): string | null {
  return deniedCountry;
}

export function clearDeniedCountry(): void {
  setDeniedCountry(null);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => deniedCountry;
const getServerSnapshot = () => null;

export function useDeniedCountry(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
