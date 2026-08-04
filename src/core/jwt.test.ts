import { describe, it, expect } from "vitest";
import { encodeSession, decodeSession, MIN_SECRET_LENGTH } from "./jwt.js";
import type { SessionClaims } from "./claims.js";

const SECRET = "a-sufficiently-long-test-secret-0123456789";
const OTHER = "a-different-long-test-secret-9876543210zzz";

const sampleClaims = (): SessionClaims<{ role: string }> => ({
  accessToken: "AT",
  refreshToken: "RT",
  tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
  user: { role: "USER" },
  remember: true,
});

describe("jwt encode/decode", () => {
  it("round-trips claims with the correct secret", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    const decoded = await decodeSession<{ role: string }>(token, SECRET);
    expect(decoded?.accessToken).toBe("AT");
    expect(decoded?.user.role).toBe("USER");
  });

  it("returns null for a token decoded with the wrong secret", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    expect(await decodeSession(token, OTHER)).toBeNull();
  });

  it("returns null for a tampered/garbage token", async () => {
    expect(await decodeSession("not-a-jwe", SECRET)).toBeNull();
    expect(await decodeSession("", SECRET)).toBeNull();
  });

  it("returns null once the JWE exp has passed", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: -1, // already expired
    });
    expect(await decodeSession(token, SECRET)).toBeNull();
  });

  it("rejects a secret shorter than the minimum length on encode", async () => {
    await expect(
      encodeSession(sampleClaims(), { secret: "short", maxAgeSeconds: 60 }),
    ).rejects.toThrow(/at least/);
  });

  it("MIN_SECRET_LENGTH is at least 32", () => {
    expect(MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(32);
  });
});

describe("jwt iss/aud binding", () => {
  it("round-trips when issuer and audience match", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
      issuer: "app-a",
      audience: "app-a",
    });
    const decoded = await decodeSession(token, SECRET, {
      issuer: "app-a",
      audience: "app-a",
    });
    expect(decoded?.accessToken).toBe("AT");
  });

  it("rejects a cookie whose issuer does not match", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
      issuer: "app-a",
    });
    expect(await decodeSession(token, SECRET, { issuer: "app-b" })).toBeNull();
  });

  it("rejects a cookie whose audience does not match", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
      audience: "aud-a",
    });
    expect(await decodeSession(token, SECRET, { audience: "aud-b" })).toBeNull();
  });

  it("rejects a cookie with no issuer when an issuer is required", async () => {
    const token = await encodeSession(sampleClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    expect(await decodeSession(token, SECRET, { issuer: "app-a" })).toBeNull();
  });
});

describe("jwt compression (zip=DEF)", () => {
  /** A realistic session: two JWTs and a long permission mask. */
  const fatClaims = (): SessionClaims<Record<string, unknown>> => ({
    accessToken: `${"h".repeat(40)}.${"p".repeat(600)}.${"s".repeat(43)}`,
    refreshToken: `${"h".repeat(40)}.${"p".repeat(200)}.${"s".repeat(43)}`,
    tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
    remember: true,
    user: {
      permissions: "9".repeat(274),
      branches: Array.from({ length: 6 }, (_, i) => `branch-id-${i}`),
      email: "someone.longish@example.com",
    },
  });

  it("keeps a realistic session well under the 4096-byte cookie limit", async () => {
    const token = await encodeSession(fatClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    // The browser limit counts name + value + attributes, so the value alone
    // must leave room for roughly 100 bytes of those.
    expect(token.length).toBeLessThan(3800);
  });

  it("round-trips a compressed session unchanged", async () => {
    const claims = fatClaims();
    const token = await encodeSession(claims, {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    const decoded = await decodeSession<Record<string, unknown>>(token, SECRET);
    expect(decoded?.accessToken).toBe(claims.accessToken);
    expect(decoded?.refreshToken).toBe(claims.refreshToken);
    expect(decoded?.user.permissions).toBe("9".repeat(274));
  });

  it("still decodes an UNCOMPRESSED token minted before zip was enabled", async () => {
    // Guards the deploy path: enabling compression must not invalidate cookies
    // already in browsers, which would log every active user out.
    const { EncryptJWT } = await import("jose");
    const key = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET)),
    );
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new EncryptJWT({ claims: sampleClaims() })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" }) // no zip
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .encrypt(key);

    const decoded = await decodeSession<{ role: string }>(legacy, SECRET);
    expect(decoded?.accessToken).toBe("AT");
  });

  it("still rejects a compressed token decoded with the wrong secret", async () => {
    const token = await encodeSession(fatClaims(), {
      secret: SECRET,
      maxAgeSeconds: 3600,
    });
    expect(await decodeSession(token, OTHER)).toBeNull();
  });
});
