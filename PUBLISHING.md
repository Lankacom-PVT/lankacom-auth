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

## Automated release (GitHub Actions)

Pushing a `v*` tag runs `.github/workflows/release-npm.yml`. It checks the tag
matches `package.json`'s version, skips if that version is already on npm,
then installs, typechecks, tests, builds and publishes. Pre-release versions
(`1.2.0-beta.1`) go to the `next` dist-tag.

```bash
npm version patch --no-git-tag-version    # bump package.json (+ update CHANGELOG.md)
git commit -am "release: v0.4.2"
git tag v0.4.2
git push --follow-tags                    # the tag push triggers the release
```

It authenticates with npm **trusted publishing** (OIDC), so there is no npm
token to store or rotate, and each release gets a provenance attestation.
One-time setup on npmjs.com → `@lankacom/auth` → Settings → Trusted
publishing → GitHub Actions:

| Field                  | Value              |
| ---------------------- | ------------------ |
| Organization or user   | `Lankacom-PVT`     |
| Repository             | `lankacom-auth`    |
| Workflow filename      | `release-npm.yml`  |

## Publish manually

The fallback when CI is unavailable. npm **rejects re-publishing the same
version**, so bump first:

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

1. `pnpm typecheck && pnpm test && pnpm build` — green.
2. `npm version patch|minor|major --no-git-tag-version` and a `CHANGELOG.md` entry.
3. Commit, then `git tag v<version>` matching `package.json`.
4. `git push --follow-tags` — the **Release to npm** workflow publishes it.
5. Check the workflow run on GitHub, then `npm view @lankacom/auth version`.
6. In consuming apps: `pnpm add @lankacom/auth@<new-version>`.
