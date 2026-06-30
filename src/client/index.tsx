"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SessionClaims, SessionStatus } from "../core/index.js";

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

export interface SessionProviderProps {
  children: ReactNode;
  /** Route that returns the decoded session snapshot. Default "/api/auth/session". */
  sessionEndpoint?: string;
}

export const SessionProvider = ({
  children,
  sessionEndpoint = "/api/auth/session",
}: SessionProviderProps) => {
  const [state, setState] = useState<SessionContextValue<unknown>>({
    data: null,
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    fetch(sessionEndpoint, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionClaims<unknown> | null) => {
        if (cancelled) return;
        setState({
          data,
          status: data ? "authenticated" : "unauthenticated",
        });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionEndpoint]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
};

/** Drop-in for next-auth's useSession — but returns no update(). */
export const useSession = <TUser = Record<string, unknown>>(): {
  data: SessionClaims<TUser> | null;
  status: SessionStatus;
} => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within <SessionProvider>");
  }
  return ctx as { data: SessionClaims<TUser> | null; status: SessionStatus };
};
