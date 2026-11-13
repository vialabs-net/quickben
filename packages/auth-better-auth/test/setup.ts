import { DatabaseSync } from "node:sqlite";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, organization } from "better-auth/plugins";

import type { BetterAuthOptions } from "better-auth";

/** A real Better Auth instance on an in-memory SQLite database. No network. */
export async function createTestAuth<const O extends Partial<BetterAuthOptions>>(
  extra: O = {} as O,
) {
  const base = {
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-0123",
    database: new DatabaseSync(":memory:"),
    emailAndPassword: { enabled: true },
    telemetry: { enabled: false },
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
  const auth = betterAuth({ ...base, ...extra });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  return auth;
}

export const plugins = { admin, organization };

/** Sign up through the Better Auth handler and return the session cookie as request headers. */
export async function signUp(
  auth: { handler: (req: Request) => Promise<Response> },
  email: string,
): Promise<Headers> {
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password: "password-123", name: email.split("@")[0] }),
    }),
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}
