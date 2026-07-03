import type { RegisteredUser } from "@lankacom/auth/register";

/**
 * FATAL rotation failure: the backend answered and REJECTED the refresh token
 * (adapter threw an error tagged `code: "REFRESH_REJECTED"`, `mapTokenResponse`
 * threw on the exchanged response, or `validateUser` refused the user). The
 * session is unrecoverable — consumers should sign out on this value.
 */
export const REFRESH_TOKEN_ERROR = "RefreshTokenError";

/**
 * TRANSIENT rotation failure: the backend could not be reached (network error,
 * DNS, timeout, or an unparseable OK response) — the refresh token was NOT
 * judged invalid. The session cookie is left intact and rotation is retried on
 * the next request; consumers must NOT sign out on this value.
 */
export const REFRESH_TRANSIENT_ERROR = "RefreshTransientError";

/** Rotation-failure classification carried on `SessionClaims.error`. */
export type SessionError =
  | typeof REFRESH_TOKEN_ERROR
  | typeof REFRESH_TRANSIENT_ERROR;

/**
 * Canonical session claims the engine understands. Apps extend the user shape
 * via the generic `TUser` (defaulting to the registered user type — see
 * `@lankacom/auth/register`); everything else is auth-mechanism state the
 * engine owns. `tokenExpiry` is ALWAYS epoch SECONDS (not ms) — a hard
 * invariant shared with the backend.
 */
export interface SessionClaims<TUser = RegisteredUser> {
  /** Bearer access token attached to authenticated backend calls. */
  accessToken: string;
  /** Single-use refresh token. Present only when remember-me is on. */
  refreshToken?: string;
  /** Access-token expiry, epoch SECONDS. */
  tokenExpiry: number;
  /** App-defined user payload (identity, permissions, tenant, etc.). */
  user: TUser;
  /** Drives cookie lifetime: true = sliding persistent cookie, false = session cookie. */
  remember: boolean;
  /** How the session was established. */
  authMethod?: "credentials" | "pre-issued" | "sso";
  /**
   * Set when rotation failed. "RefreshTokenError" = fatal (backend rejected
   * the token → sign out); "RefreshTransientError" = backend unreachable
   * (keep the session; rotation retries on the next request).
   */
  error?: SessionError;
}

/** Status a client consumer observes, mirroring next-auth's contract. */
export type SessionStatus = "authenticated" | "unauthenticated" | "loading";
