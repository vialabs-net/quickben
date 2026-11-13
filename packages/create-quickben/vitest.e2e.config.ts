import { defineConfig } from "vitest/config";

// Scaffolds an app, installs it from packed tarballs and runs `next build`. Needs the
// workspace packages built and network access for the registry.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
