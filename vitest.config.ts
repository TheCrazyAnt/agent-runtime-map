import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agent-runtime-map/schema": path.join(root, "packages/schema/src/index.ts"),
      "@agent-runtime-map/analysis-kit": path.join(root, "packages/analysis-kit/src/index.ts"),
      "@agent-runtime-map/python": path.join(root, "adapters/python/src/index.ts"),
      "@agent-runtime-map/project-reader": path.join(root, "packages/project-reader/src/index.ts"),
      "@agent-runtime-map/semantic": path.join(root, "packages/semantic/src/index.ts"),
      "@agent-runtime-map/react": path.join(root, "packages/react/src/index.ts"),
      "@agent-runtime-map/typescript": path.join(root, "adapters/typescript/src/index.ts"),
      "@agent-runtime-map/logic-compiler": path.join(root, "packages/logic-compiler/src/index.ts"),
      "@agent-runtime-map/core": path.join(root, "packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
