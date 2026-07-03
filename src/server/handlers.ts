import "server-only";
import { headers } from "next/headers";
import { REFRESH_TOKEN_ERROR, type SessionClaims } from "../core/index.js";
import type { Engine } from "./engine.js";
import { verifySameOrigin } from "./csrf.js";

/**
 * Route-handler factories the app mounts in the App Router.
 *
 * The session handler returns a READ-ONLY snapshot for the client provider. It
 * decodes (and may trigger rotation via getSession), but it NEVER exposes the
 * refresh token to the client — that token is the rotation secret and lives
 * only in the HttpOnly cookie.
 */
export const buildHandlers = <TUser>(engine: Engine<TUser>) => {
  /** Strip server-only secrets before sending to the browser. */
  const toClientSnapshot = (claims: SessionClaims<TUser>) => {
    const { refreshToken: _omit, ...safe } = claims;
    return safe;
  };

  /** GET /api/auth/session — read-only snapshot for useSession(). */
  const session = async (): Promise<Response> => {
    const claims = await engine.getSession();
    // null ONLY when there is no session or rotation FATALLY failed (the
    // backend rejected the refresh token). A transient failure (backend
    // unreachable) returns the snapshot WITH the error field: clients that
    // refetch the session on reconnect must not read a network blip as
    // "signed out" and trigger a client-side sign-out.
    if (!claims || claims.error === REFRESH_TOKEN_ERROR) {
      return Response.json(null, { status: 200 });
    }
    return Response.json(toClientSnapshot(claims), { status: 200 });
  };

  /**
   * POST /api/auth/signout — backend logout + clear cookie.
   *
   * State-changing, and the SameSite=Lax cookie still rides cross-site form
   * POSTs, so we CSRF-guard it with a fail-closed same-origin check (honoring
   * the app's `trustedOrigins` allowlist). A request whose Origin/Referer can't
   * be verified is rejected rather than silently logged out.
   */
  const signout = async (): Promise<Response> => {
    const h = await headers();
    if (!verifySameOrigin(h, { trustedOrigins: engine.config.trustedOrigins })) {
      return Response.json({ ok: false, error: "bad origin" }, { status: 403 });
    }
    const claims = await engine.readClaims();
    if (claims && engine.config.backend.logout) {
      try {
        await engine.config.backend.logout(claims, {});
      } catch {
        // best-effort backend logout; clear locally regardless.
      }
    }
    await engine.clearCookie();
    return Response.json({ ok: true }, { status: 200 });
  };

  return { session, signout, toClientSnapshot };
};
