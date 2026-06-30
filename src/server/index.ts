import "server-only";
import type { AuthConfig, SessionClaims } from "../core/index.js";
import { buildGetSession } from "./getSession.js";

export interface ServerAuth<TUser> {
  /** THE session mutator: decode → rotate-if-expired → write cookie → return. */
  getSession(): Promise<SessionClaims<TUser> | null>;
  /** getSession() + redirect to sign-in when there is no recoverable session. */
  requireSession(): Promise<SessionClaims<TUser>>;
  /** Build authenticated app→backend headers from the current session. */
  authHeaders(): Promise<Record<string, string>>;
}

/**
 * Wire the engine to an app's policy. Call ONCE in an app-local module
 * (e.g. src/lib/auth.config.ts) and re-export the returned helpers under the
 * names your call sites already use.
 */
export const createAuth = <TUser>(config: AuthConfig<TUser>): ServerAuth<TUser> => {
  const { getSession, requireSession } = buildGetSession(config);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const session = await getSession();
    if (!session) return {};
    return config.buildAuthHeaders(session);
  };

  return { getSession, requireSession, authHeaders };
};

export type { ServerAuth as ServerAuthApi };
