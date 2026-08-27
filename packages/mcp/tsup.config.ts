import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  clean: true,
  // Workspace packages are inlined so the server is self-contained; the protocol
  // SDK and ts-morph stay external and are resolved by npm like any dependency.
  noExternal: [/^@agent-runtime-map\//],
  external: ["ts-morph", "@modelcontextprotocol/sdk"],
  banner: { js: "#!/usr/bin/env node" },
});
