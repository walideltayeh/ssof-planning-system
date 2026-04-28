import type { Request, Response } from "express";
import { sdk } from "./sdk";

/**
 * Authenticate an Express request using the same session cookie tRPC uses.
 *
 * On success returns the authenticated user along with a `trustedName` derived
 * from the verified session — this is what should be recorded in audit logs
 * for endpoints that previously trusted a browser-supplied `?username=` query
 * string. Callers should never substitute the query parameter.
 *
 * On failure writes a 401 response and returns `null`, so the caller pattern
 * is `const auth = await authenticateHttpRequest(req, res); if (!auth) return;`.
 */
export async function authenticateHttpRequest(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    // Mirror the tRPC `getAuditActor` fallback: a successfully authenticated
    // user without a stored display name still gets through; we just label the
    // audit row "System" rather than rejecting the upload. The important
    // guarantee — that the actor is not a browser-supplied query string — is
    // preserved either way.
    const trustedName = user.name?.trim() || "System";
    return { user, trustedName };
  } catch {
    res.status(401).json({ error: "Unauthenticated" });
    return null;
  }
}

/**
 * Admin-only variant. Mirrors `adminProcedure` in the tRPC router, which
 * authorizes by `users.role === 'admin'` (set for AppUser admins/owners by
 * `establishAppUserSession`). Returns null after writing a 401/403 response,
 * so callers should `if (!auth) return;`.
 */
export async function authenticateHttpAdmin(req: Request, res: Response) {
  const auth = await authenticateHttpRequest(req, res);
  if (!auth) return null;
  if (auth.user.role !== "admin") {
    res.status(403).json({ error: "Admin privileges required" });
    return null;
  }
  return auth;
}
