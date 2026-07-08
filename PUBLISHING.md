# Publishing `@lankacom/auth`

This package is published publicly to the **npm registry** under the
`@lankacom` scope, with source on **GitHub** at
[`Lankacom-PVT/lankacom-auth`](https://github.com/Lankacom-PVT/lankacom-auth).

| Value       | This package                                     |
| ----------- | ------------------------------------------------ |
| Registry    | `https://registry.npmjs.org/` (public npm)       |
| Scope       | `@lankacom` (npm org)                             |
| Access      | `public` (set via `publishConfig.access`)        |
| Source      | `github.com/Lankacom-PVT/lankacom-auth`              |
| License     | Apache-2.0                                        |

---

## One-time setup

### 1. npm

You must be a member of the `lankacom` npm org with publish rights. Then:

```bash
npm login          # authenticate this machine against registry.npmjs.org
npm whoami         # confirm
```

The `@lankacom` scope resolves to the public registry by default; no `.npmrc`
scope override is needed. (The old Gitea `.npmrc` is gitignored — remove it if
present so it doesn't redirect the scope.)

### 2. GitHub

Repo lives at `github.com/Lankacom-PVT/lankacom-auth`. Push with the `origin`
remote already configured.

---

## Publish

npm **rejects re-publishing the same version**, so bump first:

```bash
npm version patch --no-git-tag-version    # 0.3.0 → 0.3.1 (or minor / major)
pnpm publish                              # prepublishOnly runs typecheck + build
                                          # publishConfig.access=public applies
```

### Verify it landed

```bash
npm view @lankacom/auth version
```

Or browse **https://www.npmjs.com/package/@lankacom/auth**.

---

## Consuming from your Next.js apps

```bash
pnpm add @lankacom/auth
```

Subpath imports:

```ts
import { defineAuthConfig } from "@lankacom/auth/core";
import { createAuth }       from "@lankacom/auth/server";  // Node runtime
import { proxyGate }        from "@lankacom/auth/edge";    // Edge / proxy.ts
import { SessionProvider, useSession } from "@lankacom/auth/client"; // "use client"
```

Optionally register your user type once for global typing (see README §2):

```ts
// lankacom-auth.d.ts
import type { User } from "@/lib/auth";
declare module "@lankacom/auth/register" {
  interface Register { user: User }
}
```

---

## Release checklist

1. `pnpm typecheck && pnpm build` — green (also runs via `prepublishOnly`).
2. `npm version patch|minor|major` — tag the release.
3. `git push && git push --tags`.
4. `pnpm publish`.
5. Verify with `npm view @lankacom/auth version`.
6. In consuming apps: `pnpm add @lankacom/auth@<new-version>`.
