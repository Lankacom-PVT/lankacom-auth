import { defineConfig } from "tsup";

// Two build passes. Splitting them lets the client pass re-add the "use client"
// directive (esbuild strips module-level directives when bundling) without
// polluting the server/core/edge outputs.
//
// The four entries map 1:1 to the package's subpath exports, which is the
// packaging-level enforcement of the runtime boundary:
//   - server: Node-only (jose decode, single-flight rotation, cookie writes)
//   - client: "use client" React hooks/provider
//   - edge:   Edge-safe ONLY (presence-only proxy gate — never decodes the JWE)
//   - core:   runtime-agnostic types + crypto primitives
// `@lankacom/auth/register` is marked external in every OTHER entry's bundle so
// its `Register` interface is referenced by module specifier — never inlined
// into a hashed dts chunk. That stable, importable module name is what makes
// `declare module "@lankacom/auth/register"` augmentation merge correctly.
const REGISTER_SPECIFIER = "@lankacom/auth/register";

const shared = {
  format: ["esm"] as const,
  dts: true,
  treeshake: true,
  splitting: false,
  external: [
    "next",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "server-only",
    REGISTER_SPECIFIER,
  ],
  esbuildOptions(options: { legalComments?: string }) {
    options.legalComments = "none";
  },
};

export default defineConfig([
  {
    ...shared,
    // clean is done by the "build" script (rimraf-free: see package script) so
    // the two concurrent passes don't race — a `clean: true` here would wipe
    // the client pass's freshly-written dts.
    clean: false,
    entry: {
      // Standalone, never-bundled entry: the canonical declaration site for the
      // augmentable `Register` interface.
      "register": "src/register.ts",
      "core/index": "src/core/index.ts",
      "server/index": "src/server/index.ts",
      "edge/index": "src/edge/index.ts",
    },
  },
  {
    format: ["esm"] as const,
    dts: true,
    treeshake: true,
    splitting: false,
    external: [
      "next",
      "react",
      "react-dom",
      "react/jsx-runtime",
      "server-only",
      REGISTER_SPECIFIER,
    ],
    clean: false,
    entry: { "client/index": "src/client/index.tsx" },
    esbuildOptions(options: { legalComments?: string }) {
      options.legalComments = "none";
    },
    // esbuild strips a "use client" banner as a "module level directive", so we
    // re-add it after the bundle is written. The directive must be the very
    // first line for React Server Components to treat this as a client boundary.
    onSuccess: async () => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const path = "dist/client/index.js";
      const code = await readFile(path, "utf8");
      if (!code.startsWith('"use client"')) {
        await writeFile(path, `"use client";\n${code}`);
      }
    },
  },
]);
