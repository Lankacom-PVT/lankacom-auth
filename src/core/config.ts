import type { SessionClaims } from "./claims.js";
import type { CookieConfig } from "./cookie.js";

/** Context passed to backend adapter calls so the app can forward headers. */
export interface RequestCtx {
  /** Incoming request headers (UA, x-real-ip, x-forwarded-host, etc.). */
  headers?: Headers | Record<string, string>;
}

/** Context for mapTokenResponse — the login/rotation intent. */
export interface MapContext<TUser> {
  /** "login" (fresh credentials), "pre-issued" (SSO/MFA), or "refresh" (rotation). */
  kind: "login" | "pre-issued" | "refresh";
  /** The remember-me intent from the caller. */
  remember: boolean;
  /** Pre-rotation claims, present only when kind === "refresh". */
  previous?: SessionClaims<TUser>;
}

/**
 * The single injection point that makes the engine app-agnostic. The app
 * supplies policy (endpoints, header names, what a valid user is); the engine
 * supplies mechanism (encode/decode, cookie lifetime, single-flight rotation).
 *
 * Generic over the app's user payload `TUser`.
 */
export interface AuthConfig<TUser> {
  /** Symmetric secret for JWE cookie encryption. App reads its own env var. */
  secret: string;

  cookie?: CookieConfig;

  /**
   * Force the `Secure` cookie attribute (and `__Secure-` name prefix) ON,
   * regardless of the `x-forwarded-proto` header. Set this `true` in any
   * production deployment served over HTTPS: without it, cookie security is
   * derived from a client-controllable forwarded header, so a stripped or
   * spoofed header can downgrade the cookie. Default false (derive from proto)
   * to keep plain-HTTP local dev working.
   */
  forceSecureCookie?: boolean;

  /**
   * Extra origins (beyond the app's own host) allowed to call state-changing
   * auth endpoints — the CSRF same-origin allowlist. Leave empty for a
   * single-domain app; the request's own host is always trusted. Format:
   * scheme + host [+ port], e.g. ["https://app.example.com"].
   */
  trustedOrigins?: string[];

  /**
   * JWE `iss`/`aud` binding. When set, the encoded cookie carries these claims
   * and decode REJECTS a cookie whose issuer/audience don't match — so a cookie
   * minted by one app (or a different audience sharing the same secret) is not
   * silently accepted here. Optional but recommended when a secret is shared
   * across services.
   */
  issuer?: string;
  audience?: string;

  /**
   * Keep (and rotate) the refresh token for NON-remember sessions too.
   *
   * By default (`false`) the refresh token is stored only when `remember` is on,
   * so a `remember=false` session simply expires when its access token does —
   * no silent renewal. That assumes the access token is long-lived enough to
   * cover a browsing session on its own.
   *
   * Set `true` when the backend issues a SHORT-lived access token that must be
   * refreshed to keep a session alive even without remember-me. Then:
   *   - the refresh token is stored in ALL sessions and rotation works for both;
   *   - `remember` now controls COOKIE LIFETIME ONLY — remember=false is still a
   *     browser SESSION cookie (dropped on full close), it just keeps refreshing
   *     while the browser is open; remember=true is the persistent sliding cookie.
   */
  alwaysPersistRefreshToken?: boolean;

  /** Access-token lifetime (seconds) used to compute tokenExpiry. Default 14m. */
  accessTokenTtl?: number;

  /**
   * Grace window (ms) during which a just-rotated result is replayed for the
   * OLD refresh token, covering RSC cookie-write no-ops and in-flight
   * stragglers. Set this <= your backend's single-use refresh grace window
   * (e.g. 30s) so a straggler never re-presents a consumed token past it.
   * Default 30000.
   */
  rotationGraceMs?: number;

  /**
   * Map an arbitrary backend response → canonical claims. REQUIRED.
   *
   * `ctx.remember` and `ctx.kind` let the app decide policy that depends on the
   * login intent rather than the response body — e.g. only keep a refresh token
   * when remember is on, or shorten the TTL when the user must change password.
   * For rotation, `ctx.previous` carries the pre-rotation claims so the app can
   * carry forward identity the refresh response omits.
   */
  mapTokenResponse(
    raw: unknown,
    ctx: MapContext<TUser>,
  ): {
    accessToken: string;
    refreshToken?: string;
    user: TUser;
    /** Per-response TTL override (e.g. short-lived must-change-password). */
    ttlSeconds?: number;
    /** Override the remember flag (e.g. force false when mustChangePassword). */
    remember?: boolean;
  };

  /** Backend calls. App owns URLs, header names, body shapes, body.status. */
  backend: {
    login(input: unknown, ctx: RequestCtx): Promise<unknown>;
    refresh(refreshToken: string, ctx: RequestCtx): Promise<unknown>;
    logout?(session: SessionClaims<TUser>, ctx: RequestCtx): Promise<void>;
  };

  /** Build outgoing headers for authenticated app→backend calls. REQUIRED. */
  buildAuthHeaders(session: SessionClaims<TUser>): Promise<Record<string, string>>;

  /** Reject a user post-auth (e.g. STUDENT/PARENT block). Default: accept all. */
  validateUser?(user: TUser): boolean;

  /** Optional device-id strategy. Engine only READS; never writes the cookie. */
  deviceId?: { read(): Promise<string | undefined> };

  /** Redirect target for unauthenticated users. Default "/auth". */
  pages?: { signIn?: string };
}

export const DEFAULT_ACCESS_TOKEN_TTL = 14 * 60; // 14 minutes
export const DEFAULT_SIGNIN_PAGE = "/auth";

/** Identity helper for authoring a typed config with inference. */
export const defineAuthConfig = <TUser>(config: AuthConfig<TUser>): AuthConfig<TUser> => config;
