import { defineConfig } from "tsup";

// Four independent entry points, each a subpath export. Keeping them separate
// is the packaging-level enforcement of the runtime boundary:
//   - server: Node-only (jose decode, single-flight rotation, cookie writes)
//   - client: "use client" React hooks/provider
//   - edge:   Edge-safe ONLY (presence-only proxy gate — never decodes the JWE)
//   - core:   runtime-agnostic types + crypto primitives
export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "edge/index": "src/edge/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  // Provided by the consuming app — never bundle these.
  external: ["next", "react", "react-dom", "react/jsx-runtime", "server-only"],
  // Preserve "use client" / "use server" directives in emitted files.
  banner: {},
  esbuildOptions(options) {
    options.legalComments = "none";
  },
});
