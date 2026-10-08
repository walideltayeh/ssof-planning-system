import { trpc } from "@/lib/trpc";

/**
 * Country visibility is a separate access layer from a user's assigned
 * countries. Keep this query fresh because an administrator may hide a
 * country while another user is working in it.
 */
export function useCountryVisibility(enabled = true) {
  return trpc.countryVisibility.list.useQuery(undefined, {
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
