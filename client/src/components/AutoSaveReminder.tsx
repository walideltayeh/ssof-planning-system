import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { toast } from "sonner";
import { Save, X } from "lucide-react";
import { useLocation } from "wouter";

const EDIT_THRESHOLD = 20; // Show reminder after this many edits
const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds

export default function AutoSaveReminder() {
  const { isAdmin } = useAppAuth();
  const { country } = useCountry();
  const [, setLocation] = useLocation();
  const lastShownRef = useRef<number>(0);

  // Key the dismiss state per country so dismissing in Syria doesn't affect Lebanon
  const dismissKey = `ssof-autosave-dismissed-at-${country ?? "global"}`;

  const editCountQuery = trpc.versions.editCount.useQuery(
    { country: country ?? undefined },
    {
      refetchInterval: CHECK_INTERVAL_MS,
      enabled: isAdmin && !!country,
    }
  );

  useEffect(() => {
    if (!isAdmin) return;
    if (!editCountQuery.data) return;

    const count = editCountQuery.data.count;
    const now = Date.now();
    const dismissedAt = parseInt(localStorage.getItem(dismissKey) || "0", 10);

    // Only show if threshold exceeded, not shown in last 5 minutes, and not recently dismissed
    if (
      count >= EDIT_THRESHOLD &&
      now - lastShownRef.current > 5 * 60_000 &&
      now - dismissedAt > 10 * 60_000
    ) {
      lastShownRef.current = now;
      const toastId = `autosave-reminder-${country ?? "global"}`;
      toast(
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <Save className="h-4 w-4 text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">
              {count} unsaved edits in {country}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              You have {count} edits in {country} since your last saved version. Consider
              saving a new version to preserve your work.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setLocation("/versions");
                  toast.dismiss(toastId);
                }}
                className="text-xs font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 rounded transition-colors"
              >
                Save Version
              </button>
              <button
                onClick={() => {
                  localStorage.setItem(dismissKey, String(Date.now()));
                  toast.dismiss(toastId);
                }}
                className="text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded transition-colors"
              >
                Remind Later
              </button>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.setItem(dismissKey, String(Date.now()));
              toast.dismiss(toastId);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            aria-label="Dismiss reminder"
          >
            <X className="h-4 w-4" />
          </button>
        </div>,
        {
          duration: 15000,
          id: `autosave-reminder-${country ?? "global"}`,
        }
      );
    }
  }, [editCountQuery.data, isAdmin, setLocation, dismissKey, country]);

  return null; // This is a headless component
}
