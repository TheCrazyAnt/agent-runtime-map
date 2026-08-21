import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  clean: true,
  noExternal: [/^@agent-runtime-map\//],
  external: ["ts-morph"],
  banner: { js: "#!/usr/bin/env node" },
});
