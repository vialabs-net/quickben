import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3300);
const baseURL = `http://localhost:${String(port)}`;

/**
 * Smoke tests against the playground. CI runs them on the production build (`pnpm build`
 * first); locally they start `next dev` unless a server is already running on the port.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: process.env.CI
      ? `pnpm exec next start --port ${String(port)}`
      : `pnpm exec next dev --port ${String(port)}`,
    url: `${baseURL}/api/_meta`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
