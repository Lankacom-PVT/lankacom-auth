import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  encodeSession,
  decodeSession,
  resolveCookieAttributes,
  resolveCookieName,
  DEFAULT_ACCESS_TOKEN_TTL,
  DEFAULT_SIGNIN_PAGE,
  type AuthConfig,
  type SessionClaims,
} from "../core/index.js";
import { Rotator } from "./rotation.js";

interface RotationResult<TUser> {
  claims: SessionClaims<TUser>;
  encoded: string;
}

/**
 * The shared server engine. Owns the one cookie writer, the one decoder, and
 * the single-flight rotator — used by getSession (rotation), signIn (mint), and
 * the route handlers. Created once per config in createAuth().
 */
export const buildEngine = <TUser>(config: AuthConfig<TUser>) => {
  const rotator = new Rotator<RotationResult<TUser>>(config.rotationGraceMs);
  const ttl = config.accessTokenTtl ?? DEFAULT_ACCESS_TOKEN_TTL;
  const signInPath = config.pages?.signIn ?? DEFAULT_SIGNIN_PAGE;
  const rememberMaxAge = config.cookie?.rememberMaxAge ?? 30 * 24 * 60 * 60;
  // JWE-exp ceiling for NON-remember sessions. The cookie is a browser session
  // cookie either way; this only bounds how long a restored/kept-open session
  // may keep refreshing. Defaults to the remember window (unchanged behavior)
  // unless the app sets sessionMaxAge — recommended when alwaysPersistRefreshToken
  // is on, to cap a non-remember session near the refresh token's real lifetime.
  const sessionMaxAge = config.cookie?.sessionMaxAge ?? rememberMaxAge;

  // rotationGraceMs replays a just-rotated result for the OLD (consumed) refresh
  // token. It MUST stay <= the backend's single-use grace window, or a straggler
  // re-presents a consumed token past that window and trips reuse detection,
  // revoking the whole token family. Flag a value large enough to be suspicious.
  if (config.rotationGraceMs !== undefined && config.rotationGraceMs > 120_000) {
    console.warn(
      `@lankacom/auth: rotationGraceMs=${config.rotationGraceMs}ms is unusually ` +
        `high. It must not exceed your backend's refresh-token grace window, or ` +
        `stragglers will re-present consumed tokens and trip reuse detection.`,
    );
  }

  const isHttps = async (): Promise<boolean> => {
    // Pin ON when the app opts into forced-secure — the forwarded proto header
    // is client-controllable and must not be able to downgrade the cookie.
    if (config.forceSecureCookie) return true;
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "";
    return proto.split(",")[0]?.trim() === "https";
  };

  const cookieName = async (): Promise<string> =>
    resolveCookieName(config.cookie?.name, await isHttps());

  /** Encode claims and persist the cookie. Lifetime keys on `remember`. */
  const mintAndWrite = async (
    claims: SessionClaims<TUser>,
  ): Promise<string> => {
    // JWE exp is bounded so a browser-restored session cookie can never outlive
    // the intended window. For remember sessions that's the sliding remember
    // window; for non-remember sessions it's the (shorter) session window, so a
    // browser "restore tabs" feature can't silently extend a refreshing
    // non-remember session for the full 30d remember window.
    const maxAgeSeconds = claims.remember ? rememberMaxAge : sessionMaxAge;
    const encoded = await encodeSession(claims, {
      secret: config.secret,
      maxAgeSeconds,
      ...(config.issuer ? { issuer: config.issuer } : {}),
      ...(config.audience ? { audience: config.audience } : {}),
    });
    await writeCookie(encoded, claims.remember);
    return encoded;
  };

  const writeCookie = async (
    encoded: string,
    remember: boolean,
  ): Promise<void> => {
    try {
      const store = await cookies();
      const attrs = resolveCookieAttributes(config.cookie, {
        isHttps: await isHttps(),
        remember,
      });
      store.set(attrs.name, encoded, {
        httpOnly: attrs.httpOnly,
        secure: attrs.secure,
        sameSite: attrs.sameSite,
        path: attrs.path,
        ...(attrs.maxAge !== undefined ? { maxAge: attrs.maxAge } : {}),
      });
    } catch {
      // cookies().set() no-ops in RSC render contexts. The recent-result cache
      // in Rotator covers the dropped-write case on the next request.
    }
  };

  const clearCookie = async (): Promise<void> => {
    try {
      const store = await cookies();
      store.delete(await cookieName());
    } catch {
      // read-only context — ignore.
    }
  };

  const readClaims = async (): Promise<SessionClaims<TUser> | null> => {
    const store = await cookies();
    const raw = store.get(await cookieName())?.value;
    if (!raw) return null;
    return decodeSession<TUser>(raw, config.secret, {
      ...(config.issuer ? { issuer: config.issuer } : {}),
      ...(config.audience ? { audience: config.audience } : {}),
    });
  };

  /**
   * Single-flight rotation of `claims` (which must carry a refresh token).
   * Used by both getSession (expiry-driven) and forceRefresh (401-driven). The
   * Rotator guarantees the backend call + cookie write happen at most once per
   * old token across concurrent callers, and replays the result within the
   * grace window.
   */
  const rotate = async (
    claims: SessionClaims<TUser>,
  ): Promise<SessionClaims<TUser>> => {
    const oldToken = claims.refreshToken!;
    const { claims: next } = await rotator.rotate(oldToken, async () => {
      const h = await headers();
      const raw = await config.backend.refresh(oldToken, { headers: h });
      const mapped = config.mapTokenResponse(raw, {
        kind: "refresh",
        remember: claims.remember,
        previous: claims,
      });
      // Re-authorize on every rotation, not just at login. A user who lost
      // access mid-session (role revoked, blocked) must not keep refreshing a
      // working session until the refresh token expires. Fail closed → the
      // caller surfaces RefreshTokenError and the client signs out.
      if (config.validateUser && !config.validateUser(mapped.user)) {
        throw new Error("User no longer permitted");
      }
      const remember = mapped.remember ?? claims.remember;
      // Mirror signIn's gate so the "remember=false ⇒ no stored refresh token"
      // invariant holds across rotation too — unless the app opts to always
      // persist it (short-lived access token needing refresh without remember).
      const persistRefresh = remember || config.alwaysPersistRefreshToken === true;
      const newClaims: SessionClaims<TUser> = {
        accessToken: mapped.accessToken,
        refreshToken: persistRefresh ? mapped.refreshToken : undefined,
        tokenExpiry: Math.floor(Date.now() / 1000) + (mapped.ttlSeconds ?? ttl),
        user: mapped.user,
        remember,
        authMethod: claims.authMethod,
      };
      const encoded = await mintAndWrite(newClaims);
      return { claims: newClaims, encoded };
    });
    return next;
  };

  /**
   * THE mutator. Decode → if expired & has refresh, rotate (single-flight) →
   * write cookie → return current claims. Returns null when no recoverable
   * session; returns claims with error="RefreshTokenError" when the rotator
   * gave up (so the client signs out).
   */
  const getSession = async (): Promise<SessionClaims<TUser> | null> => {
    const claims = await readClaims();
    if (!claims) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.tokenExpiry > nowSec) return claims;

    if (!claims.refreshToken) return null;

    try {
      return await rotate(claims);
    } catch {
      return { ...claims, error: "RefreshTokenError" };
    }
  };

  /**
   * Force a rotation REGARDLESS of expiry — for the "got a 401 from the backend
   * with a token that still looks valid" case (early revocation, clock skew).
   * Returns the rotated session, or claims with error="RefreshTokenError" when
   * rotation fails. Returns the unchanged session if there is no refresh token,
   * and null when there is no session at all. Single-flight, so calling it from
   * several concurrent failed requests still rotates only once.
   */
  const forceRefresh = async (): Promise<SessionClaims<TUser> | null> => {
    const claims = await readClaims();
    if (!claims) return null;
    if (!claims.refreshToken) return claims;
    try {
      return await rotate(claims);
    } catch {
      return { ...claims, error: "RefreshTokenError" };
    }
  };

  const requireSession = async (): Promise<SessionClaims<TUser>> => {
    const session = await getSession();
    if (!session || session.error) redirect(signInPath);
    return session;
  };

  return {
    config,
    ttl,
    rememberMaxAge,
    isHttps,
    cookieName,
    readClaims,
    mintAndWrite,
    clearCookie,
    getSession,
    requireSession,
    forceRefresh,
  };
};

export type Engine<TUser> = ReturnType<typeof buildEngine<TUser>>;
