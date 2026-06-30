/**
 * Cookie name + lifetime policy. The lifetime decision is the heart of the
 * remember-me / browser-close behavior:
 *   remember = true  → persistent cookie with `maxAge` (sliding window),
 *                      re-stamped on every rotation.
 *   remember = false → SESSION cookie (no maxAge / no expires) → the browser
 *                      drops it on full close.
 */

export interface CookieConfig {
  /** Base cookie name. `__Secure-` prefix is added automatically over https. */
  name?: string;
  /** Sliding-window length (seconds) for remember-me sessions. Default 30d. */
  rememberMaxAge?: number;
  sameSite?: "lax" | "strict" | "none";
}

const DEFAULT_NAME = "lankacom.session";
const DEFAULT_REMEMBER_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * Resolve the runtime cookie name. Over https we use the `__Secure-` prefix,
 * which the browser refuses to set without `Secure` — matches the proxy gate's
 * presence check, so they must agree. `secure` is derived from the same flag.
 */
export const resolveCookieName = (
  baseName: string | undefined,
  isHttps: boolean,
): string => {
  const base = baseName ?? DEFAULT_NAME;
  return isHttps ? `__Secure-${base}` : base;
};

export interface ResolvedCookieAttributes {
  name: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: "/";
  /** Omitted entirely when remember=false → browser session cookie. */
  maxAge?: number;
}

export const resolveCookieAttributes = (
  config: CookieConfig | undefined,
  opts: { isHttps: boolean; remember: boolean },
): ResolvedCookieAttributes => {
  const attrs: ResolvedCookieAttributes = {
    name: resolveCookieName(config?.name, opts.isHttps),
    httpOnly: true,
    secure: opts.isHttps,
    sameSite: config?.sameSite ?? "lax",
    path: "/",
  };
  if (opts.remember) {
    attrs.maxAge = config?.rememberMaxAge ?? DEFAULT_REMEMBER_MAX_AGE;
  }
  // remember === false → leave maxAge undefined → session cookie.
  return attrs;
};
