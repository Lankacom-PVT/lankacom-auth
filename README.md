# @lankacom/auth

App-agnostic auth for **Next.js App Router**. It does not authenticate users
itself — it brokers tokens from *your* backend and owns the session: an
encrypted (JWE) cookie, server-authoritative single-flight refresh-token
rotation, remember-me sliding window, and a read-only client `useSession()`.

Install & publishing → see [PUBLISHING.md](./PUBLISHING.md).
Changes & upgrade notes → see [CHANGELOG.md](./CHANGELOG.md) (**0.1.0** has three
behavior changes to check before upgrading from 0.0.x).

## Entry points

The package is split by runtime; the boundary is enforced by subpath exports.

| Import                    | Runtime     | Use it for                                            |
| ------------------------- | ----------- | ----------------------------------------------------- |
| `@lankacom/auth/core`     | agnostic    | Types, `defineAuthConfig`, JWE encode/decode          |
| `@lankacom/auth/server`   | **Node**    | `createAuth()` → session, sign-in, route handlers     |
| `@lankacom/auth/edge`     | **Edge**    | `proxyGate()` presence check in `proxy.ts`            |
| `@lankacom/auth/client`   | browser     | `<SessionProvider>`, `useSession()` (`"use client"`)  |
| `@lankacom/auth/register` | types-only  | Module-augmentation hook for your user type           |

Never import `/server` or `/core` JWE code from Edge code — the Edge entry is
crypto-free and only checks cookie presence.

## Wiring an app

### 1. Define your config (once) — `lib/auth.ts`

```ts
import { createAuth } from "@lankacom/auth/server";

export interface User {
  id: string;
  role: "ADMIN" | "USER";
  tenantId: string;
}

export const auth = createAuth<User>({
  secret: process.env.AUTH_SECRET!,         // your app's own env var

  accessTokenTtl: 5 * 60 * 60,              // access-token lifetime (seconds)
  cookie: { name: "app.session", rememberMaxAge: 7 * 24 * 60 * 60 }, // 7d
  rotationGraceMs: 30_000,                  // single-use refresh grace window
  pages: { signIn: "/login" },

  backend: {
    login:   (input, ctx)  => api.post("/login", input, ctx),
    refresh: (token, ctx)  => api.post("/refresh", { token }, ctx),
    logout:  (session, ctx) => api.post("/logout", {}, ctx),  // optional
  },

  // Map ANY backend shape → canonical claims.
  mapTokenResponse(raw: any, ctx) {
    // ctx.kind: "login" | "pre-issued" | "refresh"
    // ctx.remember; ctx.previous (prior claims, on refresh only)
    const prev = ctx.previous?.user;
    return {
      accessToken:  raw.access_token,
      refreshToken: raw.refresh_token ?? undefined,
      user: {
        id:       raw.user.id,
        role:     raw.user.role     ?? prev?.role,      // carry forward on lean refresh
        tenantId: raw.user.tenantId ?? prev?.tenantId,
      },
      // ttlSeconds / remember overrides are optional, per-response.
    };
  },

  buildAuthHeaders: async (s) => ({
    Authorization: `Bearer ${s.accessToken}`,
    tenantId: s.user.tenantId,              // any header derived from the user
  }),

  validateUser: (u) => u.role !== "STUDENT", // optional post-auth gate
});

export const {
  getSession, requireSession, forceRefresh,
  authHeaders, signIn, clearSession, handlers,
} = auth;
```

### 2. Type your user globally (optional but recommended)

So `useSession()` is typed everywhere with **no generic**, register your user
shape once. The `declare module` target MUST be `@lankacom/auth/register`.

```ts
// lankacom-auth.d.ts
import type { User } from "@/lib/auth";

declare module "@lankacom/auth/register" {
  interface Register {
    user: User;
  }
}
```

Now `getSession()`, `useSession()`, etc. all infer `user: User`. An explicit
`useSession<Other>()` still overrides it when needed.

### 3. Route handlers

```ts
// app/api/auth/session/route.ts
import { handlers } from "@/lib/auth";
export const GET = handlers.session;        // read-only snapshot (no refresh token)

// app/api/auth/signout/route.ts
import { handlers } from "@/lib/auth";
export const POST = handlers.signout;       // backend logout + clear cookie
```

### 4. Seed the client provider from the server layout

```tsx
// app/layout.tsx (server component)
import { getSession, handlers } from "@/lib/auth";
import { SessionProvider } from "@lankacom/auth/client";

export default async function RootLayout({ children }) {
  const session = await getSession();
  const initial = session ? handlers.toClientSnapshot(session) : null;
  return (
    <html><body>
      <SessionProvider initialSession={initial}>{children}</SessionProvider>
    </body></html>
  );
}
```

```tsx
"use client";
import { useSession } from "@lankacom/auth/client";
// const { data, status } = useSession(); // read-only; no update()
```

> The provider re-seeds across soft navigations, so a Server-Action `redirect()`
> after login shows the session immediately (no manual refresh needed).

### 5. Edge proxy gate (optional fast redirect)

```ts
// proxy.ts
import { proxyGate } from "@lankacom/auth/edge";

export function proxy(req) {
  const { redirectTo } = proxyGate(req.cookies, req.nextUrl.pathname, {
    cookieName: "app.session",               // or "__Secure-app.session" over https
    isProtected: (p) => p.startsWith("/app"),
    signInPath: "/login",
  });
  if (redirectTo) return Response.redirect(new URL(redirectTo, req.url));
}
```

### 6. Signing in

```ts
"use server";
import { signIn } from "@/lib/auth";

// credentials — returns ok:false with error:"MFA_REQUIRED" when MFA-gated
const res = await signIn.credentials({ email, password }, { remember });

// preIssued — mint from tokens already obtained (MFA verify / forced-enrol)
await signIn.preIssued(raw, { remember });

// sso — mint from the backend OAuth broker handoff
await signIn.sso(raw, { remember });
```

## Server API (`createAuth` return)

| Method            | Purpose                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `getSession()`    | Decode → rotate-if-expired (single-flight) → write cookie → claims   |
| `requireSession()`| `getSession()` + redirect to sign-in when unrecoverable             |
| `forceRefresh()`  | Force a rotation regardless of expiry (the 401-retry pattern)       |
| `authHeaders()`   | Build authenticated app→backend headers from the current session    |
| `signIn`          | `.credentials` / `.preIssued` / `.sso`                              |
| `clearSession()`  | Clear the session cookie (no backend call)                          |
| `handlers`        | `.session` (snapshot route), `.signout`, `.toClientSnapshot`        |

### The 401 → refresh → retry pattern

The library rotates **server-side** (on `getSession`/`forceRefresh`); it does
not wrap your `fetch` calls. Implement the retry in a small server-side helper:

```ts
import "server-only";
import { authHeaders, forceRefresh } from "@/lib/auth";

export async function apiFetch(url: string, init: RequestInit = {}) {
  const call = async () =>
    fetch(url, { ...init, headers: { ...init.headers, ...(await authHeaders()) } });

  let res = await call();
  if (res.status !== 401) return res;

  const rotated = await forceRefresh();       // swaps in the new token pair
  if (!rotated || rotated.error) return res;  // rotation failed → original 401
  return call();                              // retry once with fresh headers
}
```

## Config reference (`AuthConfig`)

| Field              | Default        | Notes                                                       |
| ------------------ | -------------- | ----------------------------------------------------------- |
| `secret`           | —              | Symmetric secret for JWE cookie encryption (required, **≥32 chars**) |
| `forceSecureCookie`| `false`        | Pin `Secure`/`__Secure-` ON regardless of `x-forwarded-proto` (set `true` in prod) |
| `trustedOrigins`   | `[]`           | Extra origins allowed to call state-changing auth routes (CSRF allowlist) |
| `issuer` / `audience` | —           | Optional JWE `iss`/`aud` binding; decode rejects a mismatch |
| `alwaysPersistRefreshToken` | `false` | Keep + rotate the refresh token for **non-remember** sessions too (short-lived access tokens). `remember` then controls cookie lifetime only |
| `cookie.sessionMaxAge` | = `rememberMaxAge` | JWE-exp ceiling (seconds) for non-remember sessions; cap near the refresh token's life when `alwaysPersistRefreshToken` is on |
| `accessTokenTtl`   | `840` (14m)    | Access-token lifetime in **seconds** → drives rotation      |
| `cookie.name`      | `lankacom.session` | `__Secure-` prefix added automatically over https      |
| `cookie.rememberMaxAge` | `2592000` (30d) | Sliding-window length for remember-me sessions        |
| `cookie.sameSite`  | `lax`          | `lax` / `strict` / `none` — use `strict` for high-security apps |
| `rotationGraceMs`  | `30000` (30s)  | Replay window for a just-rotated token (set ≤ backend grace; warns if >120s)|
| `pages.signIn`     | `/auth`        | Redirect target for unauthenticated users                   |
| `validateUser`     | accept all     | Return false to reject a user — re-checked on **every rotation** |
| `deviceId.read`    | —              | Optional device-id strategy (engine only READS)             |

### `mapTokenResponse(raw, ctx)` returns

| Field          | Notes                                                            |
| -------------- | ---------------------------------------------------------------- |
| `accessToken`  | required                                                         |
| `refreshToken` | omit to NOT persist a refresh token (e.g. `mustChangePassword`)  |
| `user`         | your `TUser`; use `ctx.previous` to carry forward on lean refresh|
| `ttlSeconds`   | per-response TTL override (e.g. short-lived must-change-password)|
| `remember`     | per-response remember override                                  |

## Notes

- `tokenExpiry` is **epoch seconds** (hard invariant shared with the backend).
- `remember=false` → browser **session cookie** (dropped on close);
  `remember=true` → sliding persistent cookie, re-stamped on every rotation.
- By default a `remember=false` session holds **no refresh token** and simply
  expires with its access token. If your backend issues **short-lived** access
  tokens that must be refreshed to survive a browsing session, set
  `alwaysPersistRefreshToken: true`: the refresh token is then kept and rotated
  for every session, and `remember` controls **cookie lifetime only** — a
  non-remember session keeps refreshing while the tab is open but still drops on
  browser close. Pair it with `cookie.sessionMaxAge` to bound how long a
  browser-restored non-remember session may keep refreshing.
- The refresh token never reaches the client — it's stripped from the snapshot
  and lives only in the HttpOnly encrypted cookie.
- Rotation is **single-flight**: concurrent requests for the same expired token
  share one backend refresh; a `recentTtl` grace window replays the result for
  stragglers (covers RSC cookie-write no-ops + single-use refresh reuse).

## Security

- **Secret**: must be **≥32 chars** of high-entropy data — the AES-256 key is
  derived directly from it. Generate with `openssl rand -base64 32`. A short
  secret is rejected at encode time.
- **HTTPS**: set `forceSecureCookie: true` in production. Without it, the
  `Secure` flag is derived from the client-controllable `x-forwarded-proto`
  header and can be downgraded.
- **CSRF**: the built-in `signout` handler is guarded by a fail-closed
  same-origin check. Server Actions (e.g. the login action) are protected by
  Next.js itself. If you mount your **own** state-changing auth POST route, guard
  it the same way:

  ```ts
  import { verifySameOrigin } from "@lankacom/auth/server";

  export async function POST(req: Request) {
    if (!verifySameOrigin(req.headers, { trustedOrigins })) {
      return Response.json({ error: "bad origin" }, { status: 403 });
    }
    // ...
  }
  ```

- **Access token exposure**: the client session snapshot (`/api/auth/session`)
  strips the refresh token but still carries the **access token** (it's the
  bearer for client→backend calls). Treat it as browser-reachable: keep
  `accessTokenTtl` short and scope the token minimally. The refresh token never
  leaves the HttpOnly encrypted cookie.
- **Authorization on rotation**: `validateUser` is re-evaluated on every token
  rotation, so a user who loses access mid-session is signed out at the next
  refresh rather than lasting until the refresh token expires.
- **Cross-app isolation**: when several services share one `secret`, set
  distinct `issuer`/`audience` so a cookie minted by one isn't accepted by
  another.

## Working reference

A complete demo app (login, server/client session panels, SSR + CSR protected
pages, realistic 5h/7d + tenantId + mustChangePassword API mapping) lives in
[test/demo](test/demo).
