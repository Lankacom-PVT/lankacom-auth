import "server-only";
import { headers } from "next/headers";
import type { SessionClaims } from "../core/index.js";
import type { Engine } from "./engine.js";

export interface SignInResult<TUser> {
  ok: boolean;
  session?: SessionClaims<TUser>;
  /** Raw backend response, so the caller can inspect MFA gating etc. */
  raw?: unknown;
  error?: string;
}

/**
 * Build the sign-in surface bound to an engine. Three producers of a session,
 * all funnelling through the same mint+write so cookie lifetime / remember
 * behavior is identical:
 *   - credentials: POST the backend login, then mint (unless MFA-gated).
 *   - preIssued:   tokens already obtained (MFA verify, forced-enrol confirm).
 *   - sso:         tokens handed back by the backend OAuth broker.
 */
export const buildSignIn = <TUser>(engine: Engine<TUser>) => {
  const { config, ttl } = engine;

  const mintFromRaw = async (
    raw: unknown,
    opts: { kind: "login" | "pre-issued"; remember: boolean; authMethod: SessionClaims<TUser>["authMethod"] },
  ): Promise<SignInResult<TUser>> => {
    const mapped = config.mapTokenResponse(raw, {
      kind: opts.kind,
      remember: opts.remember,
    });

    if (config.validateUser && !config.validateUser(mapped.user)) {
      return { ok: false, raw, error: "User not permitted" };
    }

    const remember = mapped.remember ?? opts.remember;
    // Persist the refresh token when remember is on, OR when the app opts to keep
    // it for every session (short-lived access token that must be refreshed even
    // without remember-me). remember then controls cookie lifetime only.
    const persistRefresh = remember || config.alwaysPersistRefreshToken === true;
    const claims: SessionClaims<TUser> = {
      accessToken: mapped.accessToken,
      refreshToken: persistRefresh ? mapped.refreshToken : undefined,
      tokenExpiry: Math.floor(Date.now() / 1000) + (mapped.ttlSeconds ?? ttl),
      user: mapped.user,
      remember,
      authMethod: opts.authMethod,
    };

    await engine.mintAndWrite(claims);
    return { ok: true, session: claims, raw };
  };

  /**
   * Credentials login. Returns the raw response WITHOUT minting when the
   * backend gates on MFA (caller drives the MFA flow then calls preIssued).
   */
  const credentials = async (
    input: unknown,
    opts: { remember: boolean; isMfaGated?: (raw: unknown) => boolean },
  ): Promise<SignInResult<TUser>> => {
    const h = await headers();
    const raw = await config.backend.login(input, { headers: h });
    if (opts.isMfaGated?.(raw)) {
      return { ok: false, raw, error: "MFA_REQUIRED" };
    }
    return mintFromRaw(raw, {
      kind: "login",
      remember: opts.remember,
      authMethod: "credentials",
    });
  };

  /** Mint from tokens already obtained (MFA verify / forced-enrol confirm). */
  const preIssued = async (
    raw: unknown,
    opts: { remember: boolean },
  ): Promise<SignInResult<TUser>> =>
    mintFromRaw(raw, {
      kind: "pre-issued",
      remember: opts.remember,
      authMethod: "pre-issued",
    });

  /** Mint from the backend SSO broker handoff. */
  const sso = async (
    raw: unknown,
    opts: { remember: boolean },
  ): Promise<SignInResult<TUser>> =>
    mintFromRaw(raw, {
      kind: "pre-issued",
      remember: opts.remember,
      authMethod: "sso",
    });

  return { credentials, preIssued, sso };
};
