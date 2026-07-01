import { createAuth } from "@lankacom/auth/server";

/**
 * Demo wiring of @lankacom/auth modelling a real API contract:
 *
 *   - access token: 5h, sent as `Authorization: Bearer <token>`
 *   - refresh token: 7d, SINGLE-USE (rotated on every refresh), 30s grace
 *   - `tenantId` header required, must match the token's tenant
 *   - `mustChangePassword`: no refresh token issued until password changed
 *   - on 401 → forceRefresh() → retry (see lib/apiFetch.ts)
 *
 * The "backend" here is the mock under /api/mock. Swap those URLs for your real
 * endpoints and this config is production-shaped.
 */

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  tenantId: string;
  /** Only true between login and password change; gates the app. */
  mustChangePassword?: boolean;
}

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

export const auth = createAuth<DemoUser>({
  secret: process.env.AUTH_SECRET!,

  // Pin Secure cookies on in production so a stripped/spoofed x-forwarded-proto
  // can't downgrade them. Left off here so plain-http localhost dev works.
  forceSecureCookie: process.env.NODE_ENV === "production",

  // CSRF allowlist for state-changing auth routes. Empty = only this host.
  trustedOrigins: [],

  // Bind the session cookie to this app so a cookie minted elsewhere with the
  // same secret isn't silently accepted here.
  issuer: "lankacom-demo",
  audience: "lankacom-demo",

  // Short-lived access tokens: keep + rotate the refresh token even when
  // remember-me is off, so a session survives while the browser is open.
  // remember still decides persistent (true) vs session cookie (false).
  alwaysPersistRefreshToken: true,

  // Access token lifetime → drives proactive server-side rotation.
  accessTokenTtl: FIVE_HOURS,

  cookie: {
    name: "demo.session",
    // Remember-me cookie / JWE lifetime bounded by the refresh token's 7d life.
    rememberMaxAge: SEVEN_DAYS,
  },

  // Match the backend's single-use refresh grace window (30s).
  rotationGraceMs: 30_000,

  pages: { signIn: "/login" },

  backend: {
    async login(input) {
      const res = await fetch(`${BASE}/api/mock/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("login failed");
      return res.json();
    },
    async refresh(refreshToken) {
      const res = await fetch(`${BASE}/api/mock/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("refresh failed");
      return res.json();
    },
    async logout() {
      // Real contract: hit /logout to end the current session.
    },
  },

  /**
   * Map the backend response → canonical claims. Handles:
   *  - mustChangePassword: drop the refresh token + short TTL
   *  - lean refresh response: carry forward identity from ctx.previous
   */
  mapTokenResponse(raw: unknown, ctx) {
    const r = raw as {
      access_token: string;
      refresh_token: string | null;
      mustChangePassword?: boolean;
      user: Partial<DemoUser> & { id: string };
    };

    // On refresh the backend returns a lean user; carry the rest forward.
    const prev = ctx.previous?.user;
    const user: DemoUser = {
      id: r.user.id,
      name: r.user.name ?? prev?.name ?? "",
      email: r.user.email ?? prev?.email ?? "",
      role: r.user.role ?? prev?.role ?? "USER",
      tenantId: r.user.tenantId ?? prev?.tenantId ?? "",
      mustChangePassword: r.mustChangePassword ?? false,
    };

    const mustChange = user.mustChangePassword === true;

    return {
      accessToken: r.access_token,
      // No refresh token (and no remember) until the password is changed.
      refreshToken: r.refresh_token ?? undefined,
      user,
      ...(mustChange ? { remember: false, ttlSeconds: 5 * 60 } : {}),
    };
  },

  // Every authenticated app→backend call carries Bearer + tenantId.
  buildAuthHeaders: async (session) => ({
    Authorization: `Bearer ${session.accessToken}`,
    tenantId: session.user.tenantId,
  }),
});

export const {
  getSession,
  requireSession,
  forceRefresh,
  authHeaders,
  signIn,
  clearSession,
  handlers,
} = auth;
