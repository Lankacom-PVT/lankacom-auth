# @lankacom/auth

App-agnostic auth for **Next.js App Router**. It does not authenticate users
itself — it brokers tokens from *your* backend and owns the session: an
encrypted (JWE) cookie, server-authoritative single-flight refresh-token
rotation, remember-me sliding window, and a read-only client `useSession()`.

Install and publishing → see [PUBLISHING.md](./PUBLISHING.md).

## Entry points

The package is split by runtime; the boundary is enforced by subpath exports.

| Import                    | Runtime     | Use it for                                            |
| ------------------------- | ----------- | ----------------------------------------------------- |
| `@lankacom/auth/core`     | agnostic    | Types, `defineAuthConfig`, JWE encode/decode          |
| `@lankacom/auth/server`   | **Node**    | `createAuth()` → session, sign-in, route handlers     |
| `@lankacom/auth/edge`     | **Edge**    | `proxyGate()` presence check in `proxy.ts`            |
| `@lankacom/auth/client`   | browser     | `<SessionProvider>`, `useSession()` (`"use client"`)  |

Never import `/server` or `/core` JWE code from Edge code — the Edge entry is
crypto-free and only checks cookie presence.

## Wiring an app

### 1. Define your config (once)

```ts
// src/lib/auth.ts
import { createAuth } from "@lankacom/auth/server";

interface User { id: string; role: string; name: string }

export const auth = createAuth<User>({
  secret: process.env.AUTH_SECRET!,           // your app's own env var

  backend: {
    login:   (input, ctx)  => api.post("/login", input, ctx),
    refresh: (token, ctx)  => api.post("/refresh", { token }, ctx),
    logout:  (session, ctx) => api.post("/logout", {}, ctx),
  },

  // Map ANY backend shape → canonical claims.
  mapTokenResponse(raw: any, ctx) {
    return {
      accessToken:  raw.access_token,
      refreshToken: raw.refresh_token,
      user:         raw.user,
      // ctx.kind: "login" | "pre-issued" | "refresh"; ctx.remember; ctx.previous
    };
  },

  buildAuthHeaders: async (session) => ({
    Authorization: `Bearer ${session.accessToken}`,
  }),

  validateUser: (u) => u.role !== "STUDENT",   // optional gate
  pages: { signIn: "/auth" },
});

export const { getSession, requireSession, authHeaders, signIn, handlers } = auth;
```

### 2. Route handlers

```ts
// app/api/auth/session/route.ts
import { handlers } from "@/lib/auth";
export const GET = handlers.session;

// app/api/auth/signout/route.ts
import { handlers } from "@/lib/auth";
export const POST = handlers.signout;
```

### 3. Seed the client provider from the server layout

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

### 4. Edge proxy gate (optional fast redirect)

```ts
// proxy.ts
import { proxyGate } from "@lankacom/auth/edge";

export function proxy(req) {
  const { redirectTo } = proxyGate(req.cookies, req.nextUrl.pathname, {
    cookieName: "lankacom.session",          // or "__Secure-lankacom.session" over https
    isProtected: (p) => p.startsWith("/app"),
    signInPath: "/auth",
  });
  if (redirectTo) return Response.redirect(new URL(redirectTo, req.url));
}
```

### 5. Signing in

```ts
"use server";
import { signIn } from "@/lib/auth";

const res = await signIn.credentials({ email, password }, { remember });
// res.ok → session minted; res.error === "MFA_REQUIRED" → drive MFA then signIn.preIssued(...)
```

## Notes

- `tokenExpiry` is **epoch seconds** (hard invariant shared with the backend).
- `remember=false` → browser **session cookie** (dropped on close);
  `remember=true` → sliding persistent cookie, re-stamped on every rotation.
- The refresh token never reaches the client — it's stripped from the snapshot
  and lives only in the HttpOnly encrypted cookie.
