import type { SessionClaims } from "./claims.js";
import type { CookieConfig } from "./cookie.js";

/** Context passed to backend adapter calls so the app can forward headers. */
export interface RequestCtx {
  /** Incoming request headers (UA, x-real-ip, x-forwarded-host, etc.). */
  headers?: Headers | Record<string, string>;
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

  /** Access-token lifetime (seconds) used to compute tokenExpiry. Default 14m. */
  accessTokenTtl?: number;

  /** Map an arbitrary backend response → canonical claims. REQUIRED. */
  mapTokenResponse(raw: unknown): {
    accessToken: string;
    refreshToken?: string;
    user: TUser;
    /** Per-response TTL override (e.g. short-lived must-change-password). */
    ttlSeconds?: number;
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
