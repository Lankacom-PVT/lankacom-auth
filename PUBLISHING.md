# Publishing `@lankacom/auth` to Gitea

This package publishes to **Gitea's built-in npm registry**, scoped to the
`Lankacom` owner on `git-v2.lankapanel.net`.

| Value         | This package                                            |
| ------------- | ------------------------------------------------------- |
| Registry      | `https://git-v2.lankapanel.net/api/packages/Lankacom/npm/` |
| Scope         | `@lankacom`                                             |
| Token scope   | `write:package` (publish) / `read:package` (install)    |

---

## One-time setup

### 1. Create a Gitea access token

`https://git-v2.lankapanel.net` → avatar → **Settings → Applications →
Manage Access Tokens → Generate New Token** → scope **`write:package`**.
Copy it (shown once). You must be a member of the `Lankacom` org with package
write permission.

### 2. Create the local `.npmrc`

```bash
cp .npmrc.example .npmrc
# edit .npmrc — replace GITEA_TOKEN with your token
```

`.npmrc` is gitignored, so the token is never committed.

---

## Publish

Gitea **rejects re-publishing the same version**, so bump first:

```bash
npm version patch --no-git-tag-version    # 0.0.5 → 0.0.6 (or minor / major)
pnpm publish --no-git-checks              # prepublishOnly runs typecheck + build
```

`--no-git-checks` lets pnpm publish from a dirty/branchy tree; drop it once the
repo is clean and tagged if you want pnpm to enforce a clean publish.

> Current published version: **0.3.0**. See [CHANGELOG.md](./CHANGELOG.md).

### Verify it landed

```bash
npm view @lankacom/auth version \
  --registry https://git-v2.lankapanel.net/api/packages/Lankacom/npm/
```

Or browse **Gitea → Lankacom → Packages**. To delete a bad version:
**Packages → @lankacom/auth → version → Delete**.

---

## Consuming from your Next.js apps

In each app add an `.npmrc` (commit it WITHOUT the token; inject the token via
env/CI, or use a read-only token):

```ini
@lankacom:registry=https://git-v2.lankapanel.net/api/packages/Lankacom/npm/
//git-v2.lankapanel.net/api/packages/Lankacom/npm/:_authToken=${GITEA_TOKEN}
```

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
2. `npm version patch|minor|major --no-git-tag-version`.
3. `pnpm publish --no-git-checks`.
4. Verify with `npm view … version`.
5. In consuming apps: `pnpm add @lankacom/auth@<new-version>`.
