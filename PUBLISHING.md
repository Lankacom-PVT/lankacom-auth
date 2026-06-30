# Publishing `@lankacom/auth` to Gitea

This package publishes to **Gitea's built-in npm registry**, scoped to a Gitea
user or organization. Replace these placeholders everywhere below:

| Placeholder   | Meaning                                   | Example          |
| ------------- | ----------------------------------------- | ---------------- |
| `git-v2.lankapanel.net`  | Your Gitea host (no scheme)               | `git.lankacom.lk`|
| `Lankacom` | The user/org that owns the package        | `lankacom`       |
| `GITEA_TOKEN` | Gitea access token, `package` read+write  | `…`              |

> The package name is `@lankacom/auth`. The `@lankacom` **scope** is what routes
> installs and publishes to your Gitea registry — it does not have to equal
> `Lankacom`, but the registry URL path **does** use `Lankacom`.

---

## One-time setup

### 1. Create a Gitea access token

In Gitea: **Settings → Applications → Generate New Token**.
Give it the **`package`** scope (read + write). Copy the token.

### 2. Fill in the package metadata

In `package.json`, replace `git-v2.lankapanel.net` and `Lankacom` in:

- `repository.url`
- `publishConfig.registry`

### 3. Create the local `.npmrc`

```bash
cp .npmrc.example .npmrc
# then edit .npmrc, replacing git-v2.lankapanel.net / Lankacom / GITEA_TOKEN
```

`.npmrc` is gitignored, so your token is never committed.

---

## Publish

```bash
# bump the version first (semver). 0.0.1 is the current scaffold version.
pnpm version patch        # or: minor / major

# prepublishOnly runs `pnpm typecheck && pnpm build` automatically.
pnpm publish --no-git-checks
```

`--no-git-checks` lets pnpm publish from a dirty/branchy tree; drop it once the
repo is clean and tagged if you want pnpm to enforce a clean publish.

### Verify it landed

```bash
npm view @lankacom/auth --registry https://git-v2.lankapanel.net/api/packages/Lankacom/npm/
```

Or browse **Gitea → owner → Packages**.

---

## Consuming from your Next.js apps

In each app, add an `.npmrc` (commit a `.npmrc` *without* the token; inject the
token in CI / via env, or use a read-only token):

```ini
@lankacom:registry=https://git-v2.lankapanel.net/api/packages/Lankacom/npm/
//git-v2.lankapanel.net/api/packages/Lankacom/npm/:_authToken=${GITEA_TOKEN}
```

Then:

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

---

## Re-publishing

Gitea **rejects re-publishing the same version**. Always `pnpm version …`
before `pnpm publish`. To remove a bad version, delete it from
**Gitea → Packages → @lankacom/auth → version → Delete**.
