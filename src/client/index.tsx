"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SessionClaims, SessionStatus } from "../core/index.js";
import type { RegisteredUser } from "@lankacom/auth/register";

/**
 * Client session is READ-ONLY. It fetches a snapshot from a route handler that
 * only decodes the cookie — it NEVER rotates. There is deliberately no
 * update() API: rotation is server-authoritative and single-flight; a client
 * rotation would re-present a single-use refresh token and trip reuse detection.
 */

interface SessionContextValue<TUser> {
  data: SessionClaims<TUser> | null;
  status: SessionStatus;
}

const SessionContext = createContext<SessionContextValue<unknown> | null>(null);

export interface SessionProviderProps<TUser = RegisteredUser> {
  children: ReactNode;
  /**
   * Server-resolved session snapshot, passed from a server component (the root
   * layout). Seeds the context so useSession() has data on the FIRST client
   * render — without it, permission guards and other session readers see null
   * until the client fetch resolves. Mirrors next-auth's `session` prop.
   */
  initialSession?: SessionClaims<TUser> | null;
  /**
   * Set false to trust `initialSession` and skip the client snapshot fetch on
   * mount. Default true: re-fetch so a token rotated server-side mid-navigation
   * is reflected. The fetch never downgrades a valid initialSession to null on
   * transient failure.
   */
  refetchOnMount?: boolean;
  /** Route that returns the decoded session snapshot. Default "/api/auth/session". */
  sessionEndpoint?: string;
}

export const SessionProvider = <TUser = RegisteredUser,>({
  children,
  initialSession = null,
  refetchOnMount = true,
  sessionEndpoint = "/api/auth/session",
}: SessionProviderProps<TUser>) => {
  const [state, setState] = useState<SessionContextValue<unknown>>({
    data: (initialSession as SessionClaims<unknown> | null) ?? null,
    // If we were seeded, we already have an authoritative answer — don't show
    // "loading" (which guards treat as deny). Otherwise loading until fetch.
    status: initialSession
      ? "authenticated"
      : refetchOnMount
        ? "loading"
        : "unauthenticated",
  });

  // Re-seed when the SERVER prop changes. The provider typically lives in the
  // root layout and PERSISTS across soft navigations (e.g. a Server Action
  // `redirect()` after login). useState only reads its initializer on the
  // first mount, so a freshly server-rendered `initialSession` would otherwise
  // be ignored and useSession() would stay stale until a hard reload. We key
  // on the session's identity (access token + expiry) so a new server-rendered
  // object with the same content doesn't loop, but a real login/logout/rotation
  // is adopted immediately.
  const seedKey = initialSession
    ? `${initialSession.accessToken}:${initialSession.tokenExpiry}`
    : null;
  useEffect(() => {
    setState((prev) => {
      const prevKey = prev.data
        ? `${prev.data.accessToken}:${prev.data.tokenExpiry}`
        : null;
      if (prevKey === seedKey) return prev; // no change → don't churn
      return {
        data: (initialSession as SessionClaims<unknown> | null) ?? null,
        status: initialSession ? "authenticated" : "unauthenticated",
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  useEffect(() => {
    if (!refetchOnMount) return;
    let cancelled = false;
    fetch(sessionEndpoint, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionClaims<unknown> | null) => {
        if (cancelled) return;
        // Don't clobber a seeded session if the refetch transiently returns
        // null (e.g. a blip) — only update when we got a definitive answer or
        // we had nothing to begin with.
        setState({
          data,
          status: data ? "authenticated" : "unauthenticated",
        });
      })
      .catch(() => {
        // Network error: keep whatever we already have (seeded or null).
      });
    return () => {
      cancelled = true;
    };
  }, [sessionEndpoint, refetchOnMount]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
};

/** Drop-in for next-auth's useSession — but returns no update(). */
export const useSession = <TUser = RegisteredUser>(): {
  data: SessionClaims<TUser> | null;
  status: SessionStatus;
} => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within <SessionProvider>");
  }
  return ctx as { data: SessionClaims<TUser> | null; status: SessionStatus };
};
