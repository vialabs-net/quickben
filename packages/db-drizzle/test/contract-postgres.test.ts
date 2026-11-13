import { runAdapterContractTests } from "@quickben/adapter-tests";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { drizzleAdapter } from "./drizzle";

import type { DrizzleAdapter } from "../src";

// Runs only when a server is available, e.g. in the CI job with a postgres service.
const url = process.env.QUICKBEN_TEST_POSTGRES_URL;

describe.runIf(url)("postgres", () => {
  let admin: pg.Pool;
  let current: DrizzleAdapter | undefined;

  beforeAll(() => {
    admin = new pg.Pool({ connectionString: url });
  });

  afterAll(async () => {
    await admin.end();
  });

  afterEach(async () => {
    await current?.close?.();
    current = undefined;
  });

  it("connects with node-postgres", async () => {
    const result = await admin.query<{ ok: number }>("select 1 as ok");
    expect(result.rows).toEqual([{ ok: 1 }]);
  });

  runAdapterContractTests(async () => {
    // Each test starts with an empty schema.
    await admin.query("drop schema if exists public cascade; create schema public");
    current = drizzleAdapter({ dialect: "postgres", url: url ?? "", push: true });
    return current;
  });
});
