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

/**
 * Minimum secret length. The AES-256 key is derived directly from this secret
 * with a single SHA-256 (no work factor), so the secret's own entropy IS the
 * session-security boundary. A short/guessable secret is directly brute-forceable
 * and defeats the entire scheme. 32 chars is a floor, not a substitute for a
 * high-entropy random value — generate with e.g. `openssl rand -base64 32`.
 */
export const MIN_SECRET_LENGTH = 32;

/** Derive a stable 32-byte key from a secret, rejecting obviously-weak input. */
const deriveKey = async (secret: string): Promise<Uint8Array> => {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `@lankacom/auth: session secret must be at least ${MIN_SECRET_LENGTH} characters ` +
        `of high-entropy data. Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  const data = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
};

export interface EncodeOptions {
  secret: string;
  /** seconds; the JWE `exp`. Mirrors the cookie maxAge for remember sessions. */
  maxAgeSeconds: number;
  /** Optional JWE `iss` binding. Verified on decode when set. */
  issuer?: string;
  /** Optional JWE `aud` binding. Verified on decode when set. */
  audience?: string;
}

export const encodeSession = async <TUser>(
  claims: SessionClaims<TUser>,
  { secret, maxAgeSeconds, issuer, audience }: EncodeOptions,
): Promise<string> => {
  const key = await deriveKey(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  let builder = new EncryptJWT({ claims } as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + maxAgeSeconds);
  if (issuer) builder = builder.setIssuer(issuer);
  if (audience) builder = builder.setAudience(audience);
  return builder.encrypt(key);
};

export interface DecodeOptions {
  /** Require this `iss`. A cookie missing/mismatching it is rejected. */
  issuer?: string;
  /** Require this `aud`. A cookie missing/mismatching it is rejected. */
  audience?: string;
}

export const decodeSession = async <TUser>(
  token: string,
  secret: string,
  options: DecodeOptions = {},
): Promise<SessionClaims<TUser> | null> => {
  try {
    const key = await deriveKey(secret);
    // jose verifies iss/aud when the corresponding option is passed, and throws
    // on mismatch (→ treated as no session, same as tamper/expiry).
    const { payload } = await jwtDecrypt(token, key, {
      ...(options.issuer ? { issuer: options.issuer } : {}),
      ...(options.audience ? { audience: options.audience } : {}),
    });
    const claims = (payload as { claims?: unknown }).claims;
    if (!claims || typeof claims !== "object") return null;
    return claims as SessionClaims<TUser>;
  } catch {
    // Expired, tampered, wrong-secret, or wrong iss/aud → treated as no session.
    return null;
  }
};
