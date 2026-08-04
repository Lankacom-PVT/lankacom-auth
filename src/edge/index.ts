/**
 * Edge-runtime entry. Intentionally tiny and crypto-free: this code runs in
 * Next.js `proxy.ts` (the middleware successor) on the Edge runtime, which
 * CANNOT decode our JWE cookie and MUST NOT rotate tokens. It performs only a
 * coarse PRESENCE check, never validation — a present-but-invalid cookie is
 * still fully validated downstream by the Node-runtime getSession().
 *
 * Do NOT import from "../core/jwt" or anything pulling in `jose` here.
 */

export interface ProxyGateOptions {
  /** Runtime-resolved cookie name. MUST match core/cookie resolveCookieName(). */
  cookieName: string;
  /** Path predicate: return true if the path requires a session. */
  isProtected: (pathname: string) => boolean;
  /** Where to send a request with no session cookie. Default "/auth". */
  signInPath?: string;
}

export interface ProxyGateDecision {
  /** When set, the proxy should redirect here. Otherwise let the request pass. */
  redirectTo?: string;
}

/**
 * Decide whether to short-circuit an obviously-logged-out request before a
 * full render. Presence-only: checks that the session cookie exists and is
 * non-empty. Never decodes.
 */
export const proxyGate = (
  cookies: { get(name: string): { value: string } | undefined },
  pathname: string,
  options: ProxyGateOptions,
): ProxyGateDecision => {
  if (!options.isProtected(pathname)) return {};
  /*
   * Chunk-safe as written: a chunked session stores its FIRST part under the
   * plain base name and any overflow under `.1`, `.2`, … so chunk 0 exists
   * whenever a session does. Still presence-only — a partial or corrupt set is
   * caught downstream by getSession(), which decodes and treats failure as no
   * session.
   */
  const cookie = cookies.get(options.cookieName);
  if (cookie && cookie.value.length > 0) return {};
  return { redirectTo: options.signInPath ?? "/auth" };
};
