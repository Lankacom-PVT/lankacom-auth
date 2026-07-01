import type { RegisteredUser } from "@lankacom/auth/register";

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
  /** Set when the single server-side rotator gives up; client signs out. */
  error?: "RefreshTokenError";
}

/** Status a client consumer observes, mirroring next-auth's contract. */
export type SessionStatus = "authenticated" | "unauthenticated" | "loading";
