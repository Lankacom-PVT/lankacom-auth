import "server-only";

/**
 * CSRF defense for state-changing auth endpoints, via same-origin verification.
 *
 * The session cookie defaults to SameSite=Lax, which still rides along on
 * cross-site top-level form POSTs — so a state-changing route (signout, and any
 * custom sign-in/rotate POST an app mounts) needs an explicit origin check or it
 * is CSRF-able. We verify the request's `Origin` (and, as a fallback, `Referer`)
 * against the request's own host, plus an optional app-supplied allowlist for
 * legitimate cross-domain callers.
 *
 * This is the OWASP-recommended header-verification pattern. Unlike a soft check
 * that waves through a request with no Origin/Referer, this FAILS CLOSED: a POST
 * that presents neither header is rejected. Every browser attaches `Origin` to
 * cross-origin (and, since ~2020, same-origin) POSTs, so the only requests with
 * neither header are non-browser clients — which should send an explicit origin
 * or be allowlisted rather than silently trusted.
 *
 * Exported so apps can guard their OWN auth POST route handlers with the same
 * logic the library uses for signout:
 *
 *   import { verifySameOrigin } from "@lankacom/auth/server";
 *   export async function POST(req: Request) {
 *     if (!verifySameOrigin(req.headers, { trustedOrigins })) {
 *       return Response.json({ error: "bad origin" }, { status: 403 });
 *     }
 *     ...
 *   }
 */

export interface SameOriginOptions {
  /**
   * Extra origins allowed beyond the request's own host, e.g.
   * ["https://app.example.com"]. Compared by normalized origin (scheme + host +
   * port). Use for legitimate cross-domain callers only.
   */
  trustedOrigins?: string[];
}

/** Normalize a URL or origin string to `scheme://host[:port]`, or null if unparseable. */
const toOrigin = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Reconstruct the request's own origin from forwarded headers. Prefers the
 * proxy-supplied `x-forwarded-*` values, falling back to `host`. Returns null
 * when there is no host at all (which then fails the check).
 */
const selfOrigin = (headers: Headers): string | null => {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";
  return toOrigin(`${proto}://${host}`);
};

/**
 * Verify the request originates from a trusted origin. Returns true only when
 * an Origin/Referer header is present AND its origin matches the request host
 * (or an allowlisted origin). Fails closed otherwise.
 */
export const verifySameOrigin = (
  headers: Headers,
  options: SameOriginOptions = {},
): boolean => {
  // Prefer Origin (sent on all cross-origin + modern same-origin state changes);
  // fall back to Referer's origin when Origin is absent (older navigations).
  const claimed =
    toOrigin(headers.get("origin")) ?? toOrigin(headers.get("referer"));
  if (!claimed) return false; // fail closed — no verifiable source

  const allowed = new Set<string>();
  const self = selfOrigin(headers);
  if (self) allowed.add(self);
  for (const o of options.trustedOrigins ?? []) {
    const norm = toOrigin(o);
    if (norm) allowed.add(norm);
  }

  return allowed.has(claimed);
};
