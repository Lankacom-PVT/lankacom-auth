import "server-only";
import type { AuthConfig, SessionClaims } from "../core/index.js";
import { buildEngine } from "./engine.js";
import { buildSignIn, type SignInResult } from "./signIn.js";
import { buildHandlers } from "./handlers.js";
export { verifySameOrigin } from "./csrf.js";
export type { SameOriginOptions } from "./csrf.js";

export interface ServerAuth<TUser> {
  /** THE session mutator: decode → rotate-if-expired → write cookie → return. */
  getSession(): Promise<SessionClaims<TUser> | null>;
  /** getSession() + redirect to sign-in when there is no recoverable session. */
  requireSession(): Promise<SessionClaims<TUser>>;
  /**
   * Force a single-flight rotation regardless of expiry — for the 401-retry
   * pattern (token rejected early by the backend). Returns the rotated session,
   * or claims with error="RefreshTokenError" on failure, or null if no session.
   */
  forceRefresh(): Promise<SessionClaims<TUser> | null>;
  /** Build authenticated app→backend headers from the current session. */
  authHeaders(): Promise<Record<string, string>>;
  /** Sign-in producers: credentials / pre-issued (MFA) / sso (broker). */
  signIn: ReturnType<typeof buildSignIn<TUser>>;
  /** Clear the session cookie (no backend call). */
  clearSession(): Promise<void>;
  /** Route-handler factories: session (snapshot), signout. */
  handlers: ReturnType<typeof buildHandlers<TUser>>;
}

/**
 * Wire the engine to an app's policy. Call ONCE in an app-local module
 * (e.g. src/lib/auth.config.ts) and re-export the returned helpers under the
 * names your call sites already use.
 */
export const createAuth = <TUser>(config: AuthConfig<TUser>): ServerAuth<TUser> => {
  const engine = buildEngine(config);
  const signIn = buildSignIn(engine);
  const handlers = buildHandlers(engine);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const session = await engine.getSession();
    if (!session) return {};
    return config.buildAuthHeaders(session);
  };

  return {
    getSession: engine.getSession,
    requireSession: engine.requireSession,
    forceRefresh: engine.forceRefresh,
    authHeaders,
    signIn,
    clearSession: engine.clearCookie,
    handlers,
  };
};

export type { ServerAuth as ServerAuthApi, SignInResult };
