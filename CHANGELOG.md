# Changelog

All notable changes to `@lankacom/auth` are documented here.

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
