import { EncryptJWT, jwtDecrypt } from "jose";
import type { SessionClaims } from "./claims.js";

/**
 * Encrypted (JWE) session cookie payload. We encrypt rather than sign because
 * the cookie carries the live access/refresh tokens — they must never be
 * readable client-side or in transit. Symmetric `dir` + A256GCM, keyed by a
 * 32-byte secret derived from the app's configured secret.
 *
 * IMPORTANT: this is Node-runtime crypto. Do NOT import this module from the
 * Edge proxy entry — the proxy only checks cookie PRESENCE, never decodes.
 */

const ALG = "dir";
const ENC = "A256GCM";

/** Derive a stable 32-byte key from an arbitrary-length secret. */
const deriveKey = async (secret: string): Promise<Uint8Array> => {
  const data = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
};

export interface EncodeOptions {
  secret: string;
  /** seconds; the JWE `exp`. Mirrors the cookie maxAge for remember sessions. */
  maxAgeSeconds: number;
}

export const encodeSession = async <TUser>(
  claims: SessionClaims<TUser>,
  { secret, maxAgeSeconds }: EncodeOptions,
): Promise<string> => {
  const key = await deriveKey(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ claims } as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + maxAgeSeconds)
    .encrypt(key);
};

export const decodeSession = async <TUser>(
  token: string,
  secret: string,
): Promise<SessionClaims<TUser> | null> => {
  try {
    const key = await deriveKey(secret);
    const { payload } = await jwtDecrypt(token, key);
    const claims = (payload as { claims?: unknown }).claims;
    if (!claims || typeof claims !== "object") return null;
    return claims as SessionClaims<TUser>;
  } catch {
    // Expired, tampered, or wrong-secret cookie → treated as no session.
    return null;
  }
};
