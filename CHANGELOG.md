# Changelog

All notable changes to `@lankacom/auth` are documented here.

## 0.3.2

### Fixed

- **`clearCookie` now emits `Secure`/`SameSite`/`Path` on the deletion cookie so
  `__Secure-`-prefixed session cookies are actually cleared on logout (browsers
  reject `__Secure-` deletes without `Secure`).** Over HTTPS the session cookie
  is written with the `__Secure-` name prefix and the `Secure` attribute, but the
  old delete path used `cookieStore.delete(name)`, which emits a bare expired
  `Set-Cookie` with no `Secure` (or `SameSite`). Browsers reject any `Set-Cookie`
  for a `__Secure-`-prefixed name that lacks `Secure`, so the deletion was
  silently ignored and the original cookie survived — the user stayed logged in
  after signout. `clearCookie` now clears by writing an empty, immediately
  expired cookie (`maxAge: 0`) whose attributes mirror the write path exactly
  (via `resolveCookieAttributes`), keeping write and clear symmetric so the
  delete targets — and is accepted for — the same `__Secure-` cookie.

## 0.3.0

### Added

- **Transient vs fatal rotation-failure split.** Rotation failures are now
  classified instead of uniformly surfacing `error: "RefreshTokenError"`:
  - **FATAL → `"RefreshTokenError"`** (unchanged string — existing consumers
    keep matching on it): the backend answered and rejected the refresh token.
    Triggers: `backend.refresh` threw an error carrying
    `code === "REFRESH_REJECTED"` (see tag convention below);
    `mapTokenResponse` threw on the exchanged response (e.g. a gateway
    200-with-`body.status !== 200` shape); or `validateUser` returned false.
  - **TRANSIENT → `"RefreshTransientError"`** (new): the backend was
    unreachable — any *untagged* throw from `backend.refresh` (fetch network
    error, DNS, timeout, or a `res.json()` parse failure on an OK response).
    The stale claims are returned with the error set, the cookie is neither
    cleared nor rewritten, and nothing is cached in the rotator, so the next
    request retries rotation. Users are no longer signed out by a backend
    deploy or network blip.
- **`REFRESH_TOKEN_ERROR` / `REFRESH_TRANSIENT_ERROR` / `SessionError`** —
  exported from `@lankacom/auth/core` next to `SessionClaims`, whose `error`
  field is now typed as the union.

### Changed

- **`requireSession()`** redirects only on no-session or the fatal
  `"RefreshTokenError"`. A transient error passes through — the access token
  may still be valid (consumers rotate ~1 min early) and rotation retries on
  the next request.
- **Session route handler** (`GET /api/auth/session`) returns `null` only for
  the fatal `"RefreshTokenError"`. On `"RefreshTransientError"` it returns the
  client snapshot (refresh token still stripped) **including the `error`
  field**, so a client that refetches the session on socket reconnect does not
  read a network blip as "signed out".

### REFRESH_REJECTED tag convention

For a rejection to be classified fatal, the app's `backend.refresh` adapter
must throw an error carrying `code: "REFRESH_REJECTED"` whenever the refresh
endpoint returns a non-OK status:

```ts
if (!res.ok) {
  throw Object.assign(new Error(`refresh failed: ${res.status}`), {
    code: "REFRESH_REJECTED",
  });
}
```

The engine detects the tag **by property, not `instanceof`** — the error
crosses the package boundary from the consumer's adapter. Any throw *without*
the tag is treated as transient.

### Migration from 0.2.x

- Update your `backend.refresh` adapter to tag rejections as above — without
  the tag, a genuine 401 is classified transient and the session lingers (with
  a stale token) instead of signing out.
- Consumers that treated **any** truthy `error` as "sign out" must narrow to
  `error === "RefreshTokenError"`.

## 0.2.0

### Added

- **`alwaysPersistRefreshToken`** — keep (and rotate) the refresh token for
  NON-remember sessions too. For backends that issue short-lived access tokens
  that must be refreshed to keep a session alive even without remember-me. When
  on, `remember` controls **cookie lifetime only**: `remember=false` stays a
  browser session cookie (drops on close) but keeps refreshing while open.
  Default `false` (unchanged behavior — non-remember sessions hold no refresh
  token and expire with their access token).
- **`cookie.sessionMaxAge`** — JWE-exp ceiling (seconds) for non-remember
  sessions, so a browser "restore tabs" feature can't silently extend a
  refreshing non-remember session for the full remember window. Defaults to
  `rememberMaxAge`; set it near the refresh token's real lifetime when
  `alwaysPersistRefreshToken` is on.

### Fixed

- **Rotation now applies the same refresh-token persistence gate as sign-in.**
  Previously `rotate()` copied the refresh token unconditionally, so a session
  whose `remember` flipped to `false` mid-rotation (e.g. via `mapTokenResponse`)
  could retain a refresh token that sign-in would have dropped. Both paths now
  agree.

### Migration from 0.1.x

None required — defaults are unchanged. Opt in with `alwaysPersistRefreshToken:
true` (and ideally `cookie.sessionMaxAge`) only if your access token is too
short-lived to carry a non-remember session on its own.

## 0.1.0

Security hardening release (VA/pentest follow-up). Most changes are additive
opt-in config, but three change existing runtime behavior — see **Migration**.

### Added

- **`forceSecureCookie`** — pin the `Secure` attribute (and `__Secure-` name
  prefix) ON regardless of the client-controllable `x-forwarded-proto` header.
  Set `true` in production.
- **`trustedOrigins`** — CSRF same-origin allowlist for state-changing auth
  routes. The request's own host is always trusted; add extra origins for
  legitimate cross-domain callers.
- **`issuer` / `audience`** — optional JWE `iss`/`aud` binding. When set, decode
  rejects a cookie whose issuer/audience don't match — isolates apps that share
  one `secret`.
- **`verifySameOrigin(headers, { trustedOrigins })`** — exported from
  `@lankacom/auth/server` so apps can CSRF-guard their own auth POST routes with
  the same fail-closed logic the built-in `signout` handler uses.
- Starter test suite (JWE encode/decode, iss/aud, single-flight rotation, CSRF).

### Changed / Security

- **Secret minimum length** — the session `secret` must now be **≥32 chars**.
  A shorter secret throws at encode time (`MIN_SECRET_LENGTH`).
- **`signout` is now CSRF-guarded** and **fails closed**: a POST whose
  `Origin`/`Referer` cannot be verified against the host (or `trustedOrigins`)
  gets a `403`.
- **`validateUser` now runs on every rotation**, not only at login. A user who
  loses access mid-session is signed out at the next token refresh.
- **Rotation cache hardening** — the in-flight/recent caches are now keyed by a
  SHA-256 of the refresh token (raw tokens no longer held as map keys) and are
  swept + size-capped to remove an unbounded-growth (memory) vector.
- **`rotationGraceMs`** now logs a warning when set above 120s (the value must
  stay ≤ your backend's single-use refresh grace window).

### Migration from 0.0.x

No code changes are required, but verify three things before deploying:

1. **Secret length** — confirm your production secret is ≥32 chars, or sign-in
   and rotation will throw:
   ```bash
   echo -n "$AUTH_SECRET" | wc -c   # must be >= 32
   ```
2. **Signout callers** — non-browser clients (mobile, server-to-server) that
   POST `/api/auth/signout` without an `Origin`/`Referer` header will now get
   `403`. Allowlist their origin via `trustedOrigins`, or send an `Origin`
   header. Normal same-origin browser logout is unaffected.
3. **`validateUser`** — it now runs on rotation, so make sure it is
   deterministic and side-effect-free (it executes far more often than before).

Recommended new production config:

```ts
createAuth({
  secret: process.env.AUTH_SECRET!,       // >= 32 chars
  forceSecureCookie: true,                 // HTTPS deployments
  issuer: "your-app",                      // distinct per app if secret shared
  audience: "your-app",
  trustedOrigins: [],                      // add cross-domain callers here
  // ...existing config
});
```

## 0.0.6

- Core authentication engine, session management, single-flight token rotation,
  remember-me sliding window, backend-brokered SSO. Gitea publishing setup.
