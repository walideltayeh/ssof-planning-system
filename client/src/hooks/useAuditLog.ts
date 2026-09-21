import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";

// Page label mapping
const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/forecast": "Forecast",
  "/ims-vs-forecast": "IMS vs Forecast",
  "/shipment": "Shipment (Production)",
  "/arrival": "Arrival to Regie",
  "/planning-fg-50g": "Planning FG 50g",
  "/planning-fg-250g": "Planning FG 250g",
  "/planning-fg-1kg": "Planning FG 1kg",
  "/upload": "Upload Data",
  "/sku-management": "SKU Management",
  "/add-year": "Add Year",
  "/user-management": "User Management",
  "/audit-trail": "Audit Trail",
};

/**
 * Hook that automatically logs page navigation events.
 * Call this once in the Router component.
 */
export function useNavigationLogger() {
  const [location] = useLocation();
  const { user } = useAppAuth();
  const { country } = useCountry();
  const logAction = trpc.audit.logAction.useMutation();
  const prevLocation = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Don't log the initial mount if it's the same as previous
    if (prevLocation.current === location) return;
    prevLocation.current = location;

    const pageLabel = PAGE_LABELS[location] || location;
    logAction.mutate({
      ...(country ? { country } : {}),
      action: "page_view",
      details: `Navigated to ${pageLabel}`,
      sheet: pageLabel,
    });
  }, [location, user]);
}

/** Client-recordable audit events; data changes are audited server-side by the procedure that makes them. */
export type ClientAuditAction = "page_view" | "logout" | "export_excel" | "export_pdf";

/**
 * Returns a function to log a client-side audit event (exports, sign-out).
 */
export function useAuditAction() {
  const { user } = useAppAuth();
  const { country } = useCountry();
  const logAction = trpc.audit.logAction.useMutation();

  return (params: {
    action: ClientAuditAction;
    sheet?: string;
    skuName?: string;
    periodLabel?: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
    details?: string;
  }) => {
    if (!user) return;
    logAction.mutate({
      ...(country ? { country } : {}),
      ...params,
    });
  };
}
