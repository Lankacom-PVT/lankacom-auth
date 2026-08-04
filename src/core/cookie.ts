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
  /**
   * JWE-exp ceiling (seconds) for NON-remember sessions. The cookie stays a
   * browser session cookie regardless; this only caps how long a browser-
   * restored / kept-open non-remember session may keep refreshing. Defaults to
   * `rememberMaxAge`. Set it near your refresh token's lifetime when
   * `alwaysPersistRefreshToken` is on. Not a cookie `maxAge` — session cookies
   * never carry one.
   */
  sessionMaxAge?: number;
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

/**
 * Largest value we will put in a single cookie.
 *
 * Browsers cap a cookie at 4096 bytes counting the NAME, the value and every
 * attribute — not the value alone. `__Secure-lankacom.session.0` plus
 * `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` runs to roughly
 * 100 bytes, so this leaves comfortable room under the limit without wasting
 * chunks.
 */
const MAX_CHUNK_BYTES = 3800;

/**
 * Hard ceiling on chunk count, shared by the writer and the reader.
 *
 * Bounds both the cleanup sweep and the rejoin loop so neither can run away on
 * a malformed cookie jar. Eight chunks is ~30KB of session — far beyond any
 * legitimate payload, and browsers cap total cookies per domain anyway.
 */
export const MAX_COOKIE_CHUNKS = 8;

/**
 * Split an encoded session across numbered cookies when it will not fit in one.
 *
 * Chunking happens on the ENCODED STRING, after encryption — never on the
 * claims. That matters: the parts are meaningless alone and are only ever
 * rejoined before decryption, so a missing or truncated chunk yields a JWE that
 * fails to decrypt and is treated as "no session". Splitting by MEANING instead
 * (tokens here, permissions there) would let one part expire while another
 * survives, producing a half-session that is authenticated but unauthorised —
 * a far worse failure than being logged out.
 *
 * A single-chunk session is written under the PLAIN name, so the common case is
 * byte-identical to the unchunked format and old cookies keep working.
 */
export const chunkCookieValue = (
  value: string,
  maxBytes: number = MAX_CHUNK_BYTES,
): string[] => {
  if (value.length <= maxBytes) return [value];
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += maxBytes) {
    parts.push(value.slice(i, i + maxBytes));
  }
  return parts;
};

/** Cookie name for chunk `index`: the base name, then `.0`, `.1`, … */
export const chunkCookieName = (baseName: string, index: number): string =>
  index === 0 ? baseName : `${baseName}.${index}`;

/**
 * Rejoin a chunked session from a cookie store.
 *
 * Reads the base name, then consecutive `.1`, `.2`, … until one is missing.
 * Stopping at the first gap is deliberate: a partial set cannot decrypt, and
 * concatenating across a hole would only produce a corrupt token more slowly.
 */
export const readChunkedCookie = (
  store: { get(name: string): { value: string } | undefined },
  baseName: string,
  maxChunks: number = MAX_COOKIE_CHUNKS,
): string | undefined => {
  const first = store.get(baseName)?.value;
  if (!first) return undefined;

  let joined = first;
  for (let i = 1; i < maxChunks; i += 1) {
    const next = store.get(chunkCookieName(baseName, i))?.value;
    if (!next) break;
    joined += next;
  }
  return joined;
};

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
