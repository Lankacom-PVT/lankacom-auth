import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the server-runtime-only modules so the engine loads under vitest.
vi.mock("server-only", () => ({}));

// In-memory cookie store + request headers, controllable per test.
const store = new Map<string, string>();
const reqHeaders = new Map<string, string>();
let cookieWrites = 0;
// Records the (name, value, options) of the most recent set() so tests can
// assert the attributes emitted on the wire (e.g. Secure/SameSite on delete).
let lastSet:
  | { name: string; value: string; options?: Record<string, unknown> }
  | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      store.has(name) ? { value: store.get(name)! } : undefined,
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieWrites++;
      lastSet = { name, value, options };
      // Model the browser: an empty value with maxAge<=0 removes the cookie.
      if (value === "" && typeof options?.maxAge === "number" && options.maxAge <= 0) {
        store.delete(name);
      } else {
        store.set(name, value);
      }
    },
    delete: (name: string) => store.delete(name),
  }),
  headers: async () => ({
    get: (name: string) => reqHeaders.get(name.toLowerCase()) ?? null,
  }),
}));

const { createAuth } = await import("./index.js");
const { encodeSession, decodeSession } = await import("../core/index.js");

const SECRET = "a-sufficiently-long-test-secret-0123456789";
const COOKIE = "t.session";

interface U {
  id: string;
}

/** Seed the cookie store with an already-EXPIRED session carrying RT0. */
const seedExpiredSession = async () => {
  const encoded = await encodeSession<U>(
    {
      accessToken: "AT0",
      refreshToken: "RT0",
      tokenExpiry: Math.floor(Date.now() / 1000) - 60,
      user: { id: "u_1" },
      remember: true,
    },
    { secret: SECRET, maxAgeSeconds: 3600 },
  );
  store.set(COOKIE, encoded);
};

const baseConfig = (over: Record<string, unknown> = {}) => ({
  secret: SECRET,
  cookie: { name: COOKIE },
  backend: {
    login: async () => ({}),
    refresh: async () => ({ ok: true }),
  },
  mapTokenResponse: () => ({
    accessToken: "AT1",
    refreshToken: "RT1",
    user: { id: "u_1" } as U,
  }),
  buildAuthHeaders: async () => ({}),
  ...over,
});

const readCookie = async () => {
  const raw = store.get(COOKIE);
  return raw ? decodeSession<U>(raw, SECRET) : null;
};

beforeEach(() => {
  store.clear();
  reqHeaders.clear();
  cookieWrites = 0;
  lastSet = null;
});

describe("engine rotation: single-flight", () => {
  it("10 concurrent getSession() calls rotate once and share the result", async () => {
    const refresh = vi.fn(async () => {
      // Slow enough that all 10 callers pile onto the in-flight promise.
      await new Promise((res) => setTimeout(res, 20));
      return { ok: true };
    });
    const auth = createAuth<U>(baseConfig({ backend: { login: async () => ({}), refresh } }));
    await seedExpiredSession();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => auth.getSession()),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r?.accessToken).toBe("AT1");
      expect(r?.error).toBeUndefined();
    }
    expect(cookieWrites).toBe(1);
    expect((await readCookie())?.refreshToken).toBe("RT1");
  });
});

describe("engine rotation: fatal failures → RefreshTokenError", () => {
  it("tagged REFRESH_REJECTED throw is fatal for all concurrent callers, no retry", async () => {
    const refresh = vi.fn(async () => {
      await new Promise((res) => setTimeout(res, 20));
      throw Object.assign(new Error("refresh rejected (401)"), {
        code: "REFRESH_REJECTED",
      });
    });
    const auth = createAuth<U>(baseConfig({ backend: { login: async () => ({}), refresh } }));
    await seedExpiredSession();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => auth.getSession()),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r?.error).toBe("RefreshTokenError");
    }
  });

  it("detects the tag by property, not instanceof (cross-package error)", async () => {
    // A plain object carrying the code — as it may arrive across a package
    // boundary where instanceof Error would not hold.
    const refresh = vi.fn(async () => {
      throw { code: "REFRESH_REJECTED", message: "401" };
    });
    const auth = createAuth<U>(baseConfig({ backend: { login: async () => ({}), refresh } }));
    await seedExpiredSession();

    const r = await auth.getSession();
    expect(r?.error).toBe("RefreshTokenError");
  });

  it("mapTokenResponse throw is fatal (backend answered; answer was a rejection)", async () => {
    const auth = createAuth<U>(
      baseConfig({
        mapTokenResponse: () => {
          // e.g. gateway 200-with-body.status!==200 shape
          throw new Error("body.status !== 200");
        },
      }),
    );
    await seedExpiredSession();

    const r = await auth.getSession();
    expect(r?.error).toBe("RefreshTokenError");
  });
});

describe("engine rotation: transient failures → RefreshTransientError", () => {
  it("untagged network throw keeps the session and retries on the next request", async () => {
    let attempt = 0;
    const refresh = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new TypeError("fetch failed"); // untagged
      return { ok: true };
    });
    const auth = createAuth<U>(baseConfig({ backend: { login: async () => ({}), refresh } }));
    await seedExpiredSession();
    const seeded = store.get(COOKIE);

    const first = await auth.getSession();
    expect(first?.error).toBe("RefreshTransientError");
    // Stale claims otherwise intact.
    expect(first?.accessToken).toBe("AT0");
    expect(first?.refreshToken).toBe("RT0");
    expect(first?.user).toEqual({ id: "u_1" });
    // Cookie neither cleared nor rewritten.
    expect(store.get(COOKIE)).toBe(seeded);
    expect(cookieWrites).toBe(0);

    // Failure was NOT cached in `recent` → a subsequent call rotates again.
    const second = await auth.getSession();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(second?.error).toBeUndefined();
    expect(second?.accessToken).toBe("AT1");
    expect((await readCookie())?.refreshToken).toBe("RT1");
  });

  it("forceRefresh classifies a transient failure the same way", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const auth = createAuth<U>(baseConfig({ backend: { login: async () => ({}), refresh } }));
    await seedExpiredSession();

    const r = await auth.forceRefresh();
    expect(r?.error).toBe("RefreshTransientError");
    expect(r?.accessToken).toBe("AT0");
  });
});

describe("session route handler", () => {
  it("transient error → JSON snapshot with the error field and no refreshToken", async () => {
    const auth = createAuth<U>(
      baseConfig({
        backend: {
          login: async () => ({}),
          refresh: async () => {
            throw new TypeError("fetch failed");
          },
        },
      }),
    );
    await seedExpiredSession();

    const res = await auth.handlers.session();
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.error).toBe("RefreshTransientError");
    expect(body.accessToken).toBe("AT0");
    expect(body.refreshToken).toBeUndefined();
    expect("refreshToken" in body).toBe(false);
  });

  it("fatal error → null", async () => {
    const auth = createAuth<U>(
      baseConfig({
        backend: {
          login: async () => ({}),
          refresh: async () => {
            throw Object.assign(new Error("rejected"), {
              code: "REFRESH_REJECTED",
            });
          },
        },
      }),
    );
    await seedExpiredSession();

    const res = await auth.handlers.session();
    expect(await res.json()).toBeNull();
  });
});

describe("clearSession: cookie deletion matches the write path", () => {
  it("over https emits Secure + SameSite on the __Secure- deletion cookie", async () => {
    // Same signal writeCookie uses to decide the __Secure- prefix + Secure attr.
    reqHeaders.set("x-forwarded-proto", "https");
    const auth = createAuth<U>(baseConfig());

    await auth.clearSession();

    expect(lastSet).not.toBeNull();
    // Name must carry the __Secure- prefix so we target the cookie the write
    // path actually set over https.
    expect(lastSet!.name).toBe(`__Secure-${COOKIE}`);
    // The deletion must be an expired write (empty value + maxAge 0), NOT a
    // bare delete() — otherwise the Set-Cookie lacks Secure and the browser
    // rejects the delete for the __Secure- prefix, leaving the user logged in.
    expect(lastSet!.value).toBe("");
    expect(lastSet!.options?.maxAge).toBe(0);
    expect(lastSet!.options?.secure).toBe(true);
    expect(lastSet!.options?.sameSite).toBe("lax");
    expect(lastSet!.options?.path).toBe("/");
  });

  it("forceSecureCookie forces Secure + __Secure- even without an https proto header", async () => {
    const auth = createAuth<U>(baseConfig({ forceSecureCookie: true }));

    await auth.clearSession();

    expect(lastSet!.name).toBe(`__Secure-${COOKIE}`);
    expect(lastSet!.options?.secure).toBe(true);
    expect(lastSet!.value).toBe("");
    expect(lastSet!.options?.maxAge).toBe(0);
  });

  it("over http clears the bare-named cookie without Secure", async () => {
    const auth = createAuth<U>(baseConfig());

    await auth.clearSession();

    expect(lastSet!.name).toBe(COOKIE);
    expect(lastSet!.options?.secure).toBe(false);
    expect(lastSet!.options?.maxAge).toBe(0);
  });
});
