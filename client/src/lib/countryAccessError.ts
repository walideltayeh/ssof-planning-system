import { TRPCClientError } from "@trpc/client";

const COUNTRY_ACCESS_RE = /^You do not have access to (.+)$/;

export function isCountryAccessError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const data = (error as TRPCClientError<never>).data as
    | { code?: string }
    | undefined;
  if (data?.code !== "FORBIDDEN") return false;
  return COUNTRY_ACCESS_RE.test(error.message);
}

export function extractCountryFromAccessError(error: unknown): string | null {
  if (!(error instanceof TRPCClientError)) return null;
  const m = COUNTRY_ACCESS_RE.exec(error.message);
  return m ? m[1] : null;
}
