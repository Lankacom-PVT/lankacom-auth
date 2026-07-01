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
