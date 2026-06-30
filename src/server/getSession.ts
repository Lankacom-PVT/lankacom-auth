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

// Process-wide rotator per config instance (created in createAuth).
export const buildGetSession = <TUser>(config: AuthConfig<TUser>) => {
  const rotator = new Rotator<RotationResult<TUser>>();
  const ttl = config.accessTokenTtl ?? DEFAULT_ACCESS_TOKEN_TTL;
  const signInPath = config.pages?.signIn ?? DEFAULT_SIGNIN_PAGE;

  const isHttps = async (): Promise<boolean> => {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "";
    return proto.split(",")[0]?.trim() === "https";
  };

  const cookieName = async (): Promise<string> =>
    resolveCookieName(config.cookie?.name, await isHttps());

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

  const readClaims = async (): Promise<SessionClaims<TUser> | null> => {
    const store = await cookies();
    const raw = store.get(await cookieName())?.value;
    if (!raw) return null;
    return decodeSession<TUser>(raw, config.secret);
  };

  /**
   * THE mutator. Decode → if expired & has refresh, rotate (single-flight) →
   * write cookie → return current claims. Returns null when there is no
   * recoverable session.
   */
  const getSession = async (): Promise<SessionClaims<TUser> | null> => {
    const claims = await readClaims();
    if (!claims) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.tokenExpiry > nowSec) return claims;

    // Expired.
    if (!claims.refreshToken) return null;
    const oldToken = claims.refreshToken;

    try {
      const { claims: next, encoded } = await rotator.rotate(oldToken, async () => {
        const h = await headers();
        const raw = await config.backend.refresh(oldToken, { headers: h });
        const mapped = config.mapTokenResponse(raw);
        const newClaims: SessionClaims<TUser> = {
          accessToken: mapped.accessToken,
          refreshToken: mapped.refreshToken,
          tokenExpiry: Math.floor(Date.now() / 1000) + (mapped.ttlSeconds ?? ttl),
          user: mapped.user,
          remember: claims.remember,
          authMethod: claims.authMethod,
        };
        const enc = await encodeSession(newClaims, {
          secret: config.secret,
          maxAgeSeconds: resolveMaxAge(config, newClaims.remember),
        });
        return { claims: newClaims, encoded: enc };
      });

      await writeCookie(encoded, next.remember);
      return next;
    } catch {
      return { ...claims, error: "RefreshTokenError" };
    }
  };

  /** getSession() that redirects to the sign-in page when there is no session. */
  const requireSession = async (): Promise<SessionClaims<TUser>> => {
    const session = await getSession();
    if (!session || session.error) redirect(signInPath);
    return session;
  };

  return { getSession, requireSession, writeCookie, cookieName };
};

const resolveMaxAge = <TUser>(config: AuthConfig<TUser>, remember: boolean): number => {
  if (!remember) {
    // Session cookie: JWE exp still bounded; use the remember window as a ceiling
    // so a restored-tab session cookie can't outlive the backend window.
    return config.cookie?.rememberMaxAge ?? 30 * 24 * 60 * 60;
  }
  return config.cookie?.rememberMaxAge ?? 30 * 24 * 60 * 60;
};
