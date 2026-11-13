import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PGlite starts a WebAssembly Postgres per test; CI runners are slow.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
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
