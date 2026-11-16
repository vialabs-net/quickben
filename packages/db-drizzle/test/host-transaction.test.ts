import { PGlite } from "@electric-sql/pglite";
import { createQuickben, defineCollection, defineConfig, fields as f } from "@quickben/core";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drizzleAdapter } from "./drizzle";

import type { DrizzleAdapter, PgDrizzleDatabase } from "../src";
import type { AfterCommitHook, Quickben, RequestContext } from "@quickben/core";

const system: RequestContext = { user: null, overrideAccess: true };

interface Setup {
  qb: Quickben;
  adapter: DrizzleAdapter<"pglite" | "postgres">;
  /** The host's own Drizzle database on the same connection or server. */
  host: PgDrizzleDatabase;
  committed: string[];
  /** Name of the host's own table. */
  accounts: string;
}

async function build(
  adapter: DrizzleAdapter<"pglite" | "postgres">,
  host: PgDrizzleDatabase,
  accounts = "accounts",
): Promise<Setup> {
  const committed: string[] = [];
  const record: AfterCommitHook = ({ doc }) => {
    committed.push(String(doc.name));
  };
  const members = defineCollection({
    slug: "members",
    fields: { name: f.text({ required: true, unique: true }) },
    hooks: { afterCommit: [record] },
  });
  const qb = await createQuickben(defineConfig({ db: adapter, collections: [members] }));
  await host.execute(sql.raw(`create table if not exists ${accounts} (id text primary key)`));
  return { qb, adapter, host, committed, accounts };
}

function hostTransactionTests(setup: () => Setup) {
  it("commits host rows and Quickben documents together", async () => {
    const { qb, adapter, host, committed, accounts } = setup();
    const scope = await host.transaction(async (tx) => {
      await tx.execute(sql.raw(`insert into ${accounts} (id) values ('a1')`));
      const joined = qb.withTransaction(adapter.fromTransaction(tx));
      await joined.qb.create("members", { name: "Ada" }, system);
      // Reads inside see the uncommitted row.
      expect(await joined.qb.count("members", {}, system)).toBe(1);
      return joined;
    });
    expect(committed).toEqual([]);
    await scope.committed();
    expect(committed).toEqual(["Ada"]);
    expect(await qb.count("members", {}, system)).toBe(1);
    const rows = await host.execute(sql.raw(`select id from ${accounts}`));
    expect((rows as { rows: unknown[] }).rows).toEqual([{ id: "a1" }]);
  });

  it("rolls back host rows and Quickben documents together", async () => {
    const { qb, adapter, host, committed, accounts } = setup();
    let scope: ReturnType<Quickben["withTransaction"]> | undefined;
    await expect(
      host.transaction(async (tx) => {
        await tx.execute(sql.raw(`insert into ${accounts} (id) values ('a2')`));
        scope = qb.withTransaction(adapter.fromTransaction(tx));
        await scope.qb.create("members", { name: "Grace" }, system);
        throw new Error("host step failed");
      }),
    ).rejects.toThrow("host step failed");
    await scope?.rolledBack();
    expect(committed).toEqual([]);
    expect(await qb.count("members", { where: { name: { eq: "Grace" } } }, system)).toBe(0);
    const rows = await host.execute(sql.raw(`select id from ${accounts} where id = 'a2'`));
    expect((rows as { rows: unknown[] }).rows).toEqual([]);
  });

  it("joins the host transaction from qb.transaction inside it", async () => {
    const { qb, adapter, host } = setup();
    await expect(
      host.transaction(async (tx) => {
        const scope = qb.withTransaction(adapter.fromTransaction(tx));
        await scope.qb.transaction(async (inner) => {
          await inner.create("members", { name: "Linus" }, system);
        });
        throw new Error("undo all");
      }),
    ).rejects.toThrow("undo all");
    expect(await qb.count("members", { where: { name: { eq: "Linus" } } }, system)).toBe(0);
  });
}

describe("withTransaction on PGlite", () => {
  let client: PGlite;
  let state: Setup;

  beforeAll(async () => {
    client = await PGlite.create();
    const adapter = drizzleAdapter({ dialect: "pglite", client, push: true });
    state = await build(adapter, drizzlePglite({ client }));
  });

  afterAll(async () => {
    await client.close();
  });

  hostTransactionTests(() => {
    state.committed.length = 0;
    return state;
  });

  it("needs init first", () => {
    const fresh = drizzleAdapter({ dialect: "pglite" });
    expect(() => fresh.fromTransaction(state.host)).toThrow("not initialized");
  });
});

// Runs only when a server is available, e.g. in the CI job with a postgres service.
const url = process.env.QUICKBEN_TEST_POSTGRES_URL;

describe.runIf(url)("withTransaction on node-postgres", () => {
  let pool: pg.Pool;
  let state: Setup;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query('drop schema if exists "host_tx" cascade; create schema "host_tx"');
    const adapter = drizzleAdapter({
      dialect: "postgres",
      client: pool,
      schema: "host_tx",
      push: true,
    });
    const host = drizzlePg({ client: pool }) as unknown as PgDrizzleDatabase;
    state = await build(adapter, host, "host_tx.accounts");
  });

  afterAll(async () => {
    await pool.query('drop schema if exists "host_tx" cascade');
    await pool.end();
  });

  hostTransactionTests(() => {
    state.committed.length = 0;
    return state;
  });

  it("joins a pg client that ran BEGIN", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const tx = drizzlePg({ client }) as unknown as PgDrizzleDatabase;
      const scope = state.qb.withTransaction(state.adapter.fromTransaction(tx));
      await scope.qb.create("members", { name: "Barbara" }, system);
      await client.query("rollback");
      await scope.rolledBack();
    } finally {
      client.release();
    }
    expect(await state.qb.count("members", { where: { name: { eq: "Barbara" } } }, system)).toBe(0);
  });
});
