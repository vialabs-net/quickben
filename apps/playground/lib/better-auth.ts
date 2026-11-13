import { DatabaseSync } from "node:sqlite";

import { singleton } from "@quickben/next";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

/**
 * Better Auth demo switch. Start the playground with `QUICKBEN_AUTH=better-auth` to sign in
 * with email and password instead of the role switcher. Users live in SQLite (`node:sqlite`):
 * `./.better-auth.sqlite`, or in memory with `QUICKBEN_DB=memory`.
 */
export const betterAuthEnabled = process.env.QUICKBEN_AUTH === "better-auth";

/** Password of the seeded demo users. */
export const demoPassword = "playground-password";

/** Demo accounts and their playground role. Other sign-ups are viewers. */
export const demoAccounts: Record<string, string> = {
  "admin@example.com": "admin",
  "editor@example.com": "editor",
  "viewer@example.com": "viewer",
};

function createAuth() {
  const file = process.env.QUICKBEN_DB === "memory" ? ":memory:" : "./.better-auth.sqlite";
  return betterAuth({
    // Without BETTER_AUTH_URL, Better Auth takes the URL of each request.
    baseURL: process.env.BETTER_AUTH_URL,
    // Demo only. A real app reads BETTER_AUTH_SECRET from its environment.
    secret: process.env.BETTER_AUTH_SECRET ?? "quickben-playground-demo-secret-not-for-production",
    database: new DatabaseSync(file),
    emailAndPassword: { enabled: true },
    // The e2e server runs on another port.
    trustedOrigins: (request) => (request ? [new URL(request.url).origin] : []),
    telemetry: { enabled: false },
  });
}

type Auth = ReturnType<typeof createAuth>;

async function prepare(): Promise<Auth> {
  const auth = createAuth();
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  const ctx = await auth.$context;
  for (const email of Object.keys(demoAccounts)) {
    if (await ctx.internalAdapter.findUserByEmail(email)) continue;
    await auth.api.signUpEmail({
      body: { email, password: demoPassword, name: email.split("@")[0] ?? email },
    });
  }
  return auth;
}

/**
 * The Better Auth instance, one per process. The first call creates the tables and the demo
 * users. Nothing is opened until then, so the default playground never touches SQLite.
 */
export function getAuth(): Promise<Auth> {
  return singleton("playground-better-auth", () =>
    prepare().catch((error: unknown) => {
      console.error("Better Auth setup failed", error);
      throw error;
    }),
  );
}
