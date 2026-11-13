import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin.ts"],
      // Paths relative to the repo root, as SonarCloud expects.
      reporter: ["text-summary", ["lcov", { projectRoot: resolve(import.meta.dirname, "../..") }]],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
