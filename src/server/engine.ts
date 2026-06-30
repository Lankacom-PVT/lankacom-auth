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
  const rotator = new Rotator<RotationResult<TUser>>();
  const ttl = config.accessTokenTtl ?? DEFAULT_ACCESS_TOKEN_TTL;
  const signInPath = config.pages?.signIn ?? DEFAULT_SIGNIN_PAGE;
  const rememberMaxAge = config.cookie?.rememberMaxAge ?? 30 * 24 * 60 * 60;

  const isHttps = async (): Promise<boolean> => {
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
    // JWE exp is bounded by the remember window even for session cookies, so a
    // browser-restored session cookie can never outlive the backend window.
    const encoded = await encodeSession(claims, {
      secret: config.secret,
      maxAgeSeconds: rememberMaxAge,
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
    return decodeSession<TUser>(raw, config.secret);
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
    const oldToken = claims.refreshToken;

    try {
      const { claims: next } = await rotator.rotate(oldToken, async () => {
        const h = await headers();
        const raw = await config.backend.refresh(oldToken, { headers: h });
        const mapped = config.mapTokenResponse(raw, {
          kind: "refresh",
          remember: claims.remember,
          previous: claims,
        });
        const newClaims: SessionClaims<TUser> = {
          accessToken: mapped.accessToken,
          refreshToken: mapped.refreshToken,
          tokenExpiry:
            Math.floor(Date.now() / 1000) + (mapped.ttlSeconds ?? ttl),
          user: mapped.user,
          remember: mapped.remember ?? claims.remember,
          authMethod: claims.authMethod,
        };
        const encoded = await mintAndWrite(newClaims);
        return { claims: newClaims, encoded };
      });
      return next;
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
  };
};

export type Engine<TUser> = ReturnType<typeof buildEngine<TUser>>;
