import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the server-runtime-only modules so the engine/signIn load under vitest.
vi.mock("server-only", () => ({}));

// In-memory cookie store + request headers, controllable per test.
const store = new Map<string, string>();
const reqHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      store.has(name) ? { value: store.get(name)! } : undefined,
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
  headers: async () => ({
    get: (name: string) => reqHeaders.get(name.toLowerCase()) ?? null,
  }),
}));

const { createAuth } = await import("./index.js");
const { decodeSession } = await import("../core/index.js");

const SECRET = "a-sufficiently-long-test-secret-0123456789";

interface U {
  id: string;
}

const baseConfig = (over: Record<string, unknown> = {}) => ({
  secret: SECRET,
  cookie: { name: "t.session" },
  backend: {
    login: async () => ({}),
    refresh: async () => ({ id: "u_1", fresh: true }),
  },
  mapTokenResponse: (raw: unknown) => {
    const r = raw as { fresh?: boolean };
    return {
      accessToken: r.fresh ? "AT2" : "AT1",
      refreshToken: r.fresh ? "RT2" : "RT1",
      user: { id: "u_1" } as U,
    };
  },
  buildAuthHeaders: async () => ({}),
  ...over,
});

const readCookie = async () => {
  // store key is the resolved cookie name; http (no x-forwarded-proto) → no prefix
  const raw = store.get("t.session");
  return raw ? decodeSession<U>(raw, SECRET) : null;
};

beforeEach(() => {
  store.clear();
  reqHeaders.clear();
});

describe("refresh-token persistence vs remember", () => {
  it("DEFAULT: remember=false drops the refresh token", async () => {
    const auth = createAuth<U>(baseConfig());
    await auth.signIn.credentials({}, { remember: false });
    const claims = await readCookie();
    expect(claims?.accessToken).toBe("AT1");
    expect(claims?.refreshToken).toBeUndefined();
    expect(claims?.remember).toBe(false);
  });

  it("DEFAULT: remember=true keeps the refresh token", async () => {
    const auth = createAuth<U>(baseConfig());
    await auth.signIn.credentials({}, { remember: true });
    const claims = await readCookie();
    expect(claims?.refreshToken).toBe("RT1");
    expect(claims?.remember).toBe(true);
  });

  it("alwaysPersistRefreshToken: remember=false STILL keeps the refresh token", async () => {
    const auth = createAuth<U>(baseConfig({ alwaysPersistRefreshToken: true }));
    await auth.signIn.credentials({}, { remember: false });
    const claims = await readCookie();
    expect(claims?.refreshToken).toBe("RT1");
    // Still a non-remember session (cookie lifetime unaffected).
    expect(claims?.remember).toBe(false);
  });

  it("alwaysPersistRefreshToken: a non-remember session can rotate", async () => {
    const auth = createAuth<U>(baseConfig({ alwaysPersistRefreshToken: true }));
    await auth.signIn.credentials({}, { remember: false });
    // forceRefresh rotates using the stored refresh token → new pair written.
    const rotated = await auth.forceRefresh();
    expect(rotated?.accessToken).toBe("AT2");
    expect(rotated?.refreshToken).toBe("RT2");
    expect(rotated?.remember).toBe(false);
    // And the new token is still persisted for the next rotation.
    const claims = await readCookie();
    expect(claims?.refreshToken).toBe("RT2");
  });

  it("DEFAULT: a non-remember session cannot rotate (no stored token)", async () => {
    const auth = createAuth<U>(baseConfig());
    await auth.signIn.credentials({}, { remember: false });
    const rotated = await auth.forceRefresh();
    // forceRefresh returns the unchanged session when there's no refresh token.
    expect(rotated?.accessToken).toBe("AT1");
    expect(rotated?.refreshToken).toBeUndefined();
  });
});
