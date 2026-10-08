import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { COUNTRY_CONFIG, useCountry } from "@/contexts/CountryContext";
import type { Country } from "@/contexts/AuthContext";
import { useCountryVisibility } from "@/hooks/useCountryVisibility";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COUNTRIES: Country[] = ["Lebanon", "Syria", "Libya", "KSA"];

export default function CountryManagementPage() {
  const [, navigate] = useLocation();
  const { clearCountry } = useCountry();
  const queryClient = useQueryClient();
  const visibility = useCountryVisibility();
  const [pendingCountry, setPendingCountry] = useState<Country | null>(null);
  const selected = visibility.data?.find(item => item.country === pendingCountry);
  const setHidden = trpc.countryVisibility.setHidden.useMutation({
    onSuccess: async result => {
      await visibility.refetch();
      await queryClient.invalidateQueries({
        predicate: query => {
          const key = JSON.stringify(query.queryKey).toLowerCase();
          return key.includes("country") && !key.includes("countryvisibility");
        },
      });
      toast.success(`${result.country} is now ${result.isHidden ? "hidden" : "visible"}.`);
      setPendingCountry(null);
    },
    onError: error => toast.error(error.message || "Could not update country visibility."),
  });

  const confirmChange = () => {
    if (!selected || setHidden.isPending) return;
    setHidden.mutate({ country: selected.country, hidden: !selected.isHidden });
  };

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8 sm:px-8">
      <section className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Workspace settings</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Country visibility</h1>
            <p className="mt-1 text-sm text-muted-foreground">Hide or restore country access for everyone.</p>
          </div>
          <Button variant="outline" onClick={() => { clearCountry(); navigate("/"); }}>Back to countries</Button>
        </div>

        {visibility.isLoading ? (
          <div className="space-y-3" aria-label="Loading country visibility">
            {COUNTRIES.map(country => (
              <div key={country} className="h-[76px] animate-pulse rounded-lg border bg-muted/40" />
            ))}
          </div>
        ) : visibility.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5" role="alert">
            <p className="text-sm font-medium">Country visibility could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try again. Country access has not been assumed.</p>
            <Button className="mt-4" variant="outline" onClick={() => visibility.refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            {COUNTRIES.map((country, index) => {
              const item = visibility.data?.find(entry => entry.country === country);
              if (!item) return null;
              return (
                <div
                  key={country}
                  className={`flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5 ${index ? "border-t" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-xl" aria-hidden="true">{COUNTRY_CONFIG[country].flag}</span>
                    <div>
                      <h2 className="text-sm font-medium">{COUNTRY_CONFIG[country].label}</h2>
                      <p className="text-xs text-muted-foreground">Al Fakher {country} SSOF Planning</p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        item.isHidden
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {item.isHidden ? "Hidden" : "Visible"}
                    </span>
                  </div>
                  {item.canManage && (
                    <Button
                      size="sm"
                      variant={item.isHidden ? "default" : "outline"}
                      disabled={setHidden.isPending}
                      onClick={() => setPendingCountry(country)}
                      aria-label={`${item.isHidden ? "Restore" : "Hide"} ${country}`}
                    >
                      {item.isHidden ? "Restore" : "Hide"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={!!pendingCountry} onOpenChange={open => { if (!open && !setHidden.isPending) setPendingCountry(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.isHidden ? "Restore" : "Hide"} {pendingCountry}</DialogTitle>
            <DialogDescription>
              {selected?.isHidden
                ? `Restore ${pendingCountry} so users with country permission can access it again.`
                : `Hiding ${pendingCountry} removes access for everyone, including the workspace owner. All data and history are kept; nothing is permanently deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={setHidden.isPending} onClick={() => setPendingCountry(null)}>Cancel</Button>
            <Button
              variant={selected?.isHidden ? "default" : "destructive"}
              disabled={setHidden.isPending || !selected}
              onClick={confirmChange}
            >
              {setHidden.isPending ? "Saving…" : selected?.isHidden ? "Restore country" : "Hide country"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
