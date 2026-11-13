import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { createQuickben, defineCollection, defineConfig, fields as f } from "@quickben/core";
import { count, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drizzleAdapter as pgliteAdapter } from "../src/pglite";
import { drizzleAdapter as postgresAdapter } from "../src/postgres";
import { drizzleAdapter as sqliteAdapter } from "../src/sqlite";

import { drizzleAdapter } from "./drizzle";

import type {
  DrizzleAdapter,
  DrizzleAdapterOptions,
  DrizzleRaw,
  PgGeneratedTable,
  SQLiteGeneratedTable,
} from "../src";
import type { DatabaseSchema } from "@quickben/core";

const schema: DatabaseSchema = {
  collections: [
    {
      slug: "notes",
      fields: [
        { name: "text", type: "text", many: false, required: true, unique: true, index: false },
        {
          name: "rank",
          type: "number",
          integer: true,
          many: false,
          required: false,
          unique: false,
          index: false,
        },
      ],
    },
  ],
};

const now = "2024-01-01T00:00:00.000Z";
const note = (id: string, text: string, rank: number | null = null) => ({
  collection: "notes",
  data: { id, createdAt: now, updatedAt: now, text, rank },
});

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quickben-adapter-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function ready(options: DrizzleAdapterOptions): Promise<DrizzleAdapter> {
  const db = drizzleAdapter(options as Extract<DrizzleAdapterOptions, { dialect: "sqlite" }>);
  await db.init(schema);
  return db;
}

describe.each([{ dialect: "pglite" }, { dialect: "sqlite" }] as const)("$dialect", (options) => {
  it("exposes the Drizzle database and the generated tables", async () => {
    const db = await ready(options);
    expect(db.name).toBe("drizzle");
    expect(db.dialect).toBe(options.dialect);
    await db.create(note("n1", "hello", 1));
    const raw = db.raw;
    expect(Object.keys(raw.tables)).toEqual(["notes"]);
    const rows =
      raw.dialect === "sqlite"
        ? await (raw as DrizzleRaw<"sqlite">).db
            .select()
            .from(raw.table("notes") as SQLiteGeneratedTable)
            .where(eq((raw.table("notes") as SQLiteGeneratedTable).text!, "hello"))
        : await (raw as DrizzleRaw<"pglite">).db
            .select()
            .from(raw.table("notes") as PgGeneratedTable)
            .where(eq((raw.table("notes") as PgGeneratedTable).text!, "hello"));
    expect(rows).toHaveLength(1);
    expect(() => raw.table("missing")).toThrow('unknown collection "missing"');
    await db.close?.();
  });

  it("binds raw.db to the transaction", async () => {
    const db = await ready(options);
    await expect(
      db.transaction(async (tx) => {
        await tx.create(note("n1", "a"));
        expect(tx.raw.db).not.toBe(db.raw.db);
        await tx.transaction(async (inner) => {
          expect(inner).toBe(tx);
          await inner.create(note("n2", "b"));
        });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await db.count({ collection: "notes" })).toBe(0);
    await db.close?.();
  });

  it("keeps writes outside a transaction out of it", async () => {
    const db = await ready(options);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tx = db.transaction(async (inner) => {
      await inner.create(note("in", "in"));
      await gate;
      throw new Error("rollback");
    });
    const outside = db.create(note("out", "out"));
    release();
    await expect(tx).rejects.toThrow("rollback");
    await outside;
    expect((await db.find({ collection: "notes" })).map((doc) => doc.id)).toEqual(["out"]);
    await db.close?.();
  });

  it("reports the taken field", async () => {
    const db = await ready(options);
    await db.create(note("n1", "same"));
    await expect(db.create(note("n2", "same"))).rejects.toMatchObject({
      code: "CONFLICT",
      field: "text",
    });
    await expect(db.create(note("n1", "other"))).rejects.toMatchObject({ field: "id" });
    await db.close?.();
  });

  it("handles offsets, unknown select names and empty updates", async () => {
    const db = await ready(options);
    for (const [index, text] of ["a", "b", "c"].entries())
      await db.create(note(`n${index}`, text, index));
    const sort = [{ field: "rank", direction: "asc" }] as const;
    expect(
      (await db.find({ collection: "notes", sort, offset: 1 })).map((doc) => doc.text),
    ).toEqual(["b", "c"]);
    expect(
      await db.find({ collection: "notes", sort, limit: 1, select: ["text", "id", "nope"] }),
    ).toEqual([{ id: "n0", text: "a" }]);
    expect(await db.update({ collection: "notes", id: "n1", data: { id: "n1" } })).toMatchObject({
      text: "b",
    });
    expect(await db.update({ collection: "notes", id: "zz", data: {} })).toBeNull();
    await db.close?.();
  });

  it("rejects unknown collections and use before init", async () => {
    const db = drizzleAdapter(options);
    expect(() => db.raw.db).toThrow("not initialized");
    expect(db.raw.tables).toEqual({});
    await db.init(schema);
    await expect(db.find({ collection: "missing" })).rejects.toThrow(
      'unknown collection "missing"',
    );
    await db.close?.();
    await db.close?.();
  });
});

describe("connections", () => {
  it("uses an existing PGlite client and leaves it open", async () => {
    const client = await PGlite.create();
    const db = drizzleAdapter({ dialect: "pglite", client });
    await db.init(schema);
    await db.create(note("n1", "a"));
    await db.close?.();
    expect(
      (await client.query<{ n: number }>('select count(*)::int as n from "notes"')).rows[0]?.n,
    ).toBe(1);
    await client.close();
  });

  it("persists PGlite data in dataDir when pushed", async () => {
    const dataDir = join(dir, "pglite");
    const first = await ready({ dialect: "pglite", dataDir, push: true });
    await first.create(note("n1", "a"));
    await first.close?.();
    const second = await ready({ dialect: "pglite", dataDir });
    expect(await second.count({ collection: "notes" })).toBe(1);
    await second.close?.();
  });

  it("opens a SQLite file and serializes a file client", async () => {
    const url = `file:${join(dir, "app.db")}`;
    const db = await ready({ dialect: "sqlite", url, push: true });
    await db.create(note("n1", "a"));
    await db.close?.();
    const client = createClient({ url });
    const again = await ready({ dialect: "sqlite", client });
    expect(await again.count({ collection: "notes" })).toBe(1);
    await again.close?.();
    client.close();
  });

  it("needs a url or a client for Postgres", async () => {
    await expect(drizzleAdapter({ dialect: "postgres" }).init(schema)).rejects.toMatchObject({
      code: "CONFIG",
    });
    const pool = new pg.Pool({ connectionString: "postgres://localhost:1/none" });
    const withPool = drizzleAdapter({ dialect: "postgres", client: pool });
    await withPool.init(schema);
    await withPool.close?.();
    await pool.end();
    const withUrl = drizzleAdapter({
      dialect: "postgres",
      url: "postgres://localhost:1/none",
      pool: { max: 1 },
    });
    await withUrl.init(schema);
    await withUrl.close?.();
  });

  it("takes the dialect from the entry point", async () => {
    const db = pgliteAdapter();
    expect(db.dialect).toBe("pglite");
    expect(sqliteAdapter({ dialect: "sqlite" }).dialect).toBe("sqlite");
    expect(postgresAdapter({ url: "postgres://localhost:1/none" }).dialect).toBe("postgres");
    await db.init(schema);
    expect(await db.count({ collection: "notes" })).toBe(0);
    await db.close?.();
  });
});

it("works with createQuickben and qb.db.raw", async () => {
  const posts = defineCollection({
    slug: "posts",
    fields: {
      title: f.text({ required: true }),
      tags: f.select({ options: ["a", "b"], many: true }),
    },
    access: { read: () => true, create: () => true },
  });
  const config = defineConfig({ db: drizzleAdapter({ dialect: "pglite" }), collections: [posts] });
  const qb = await createQuickben(config);
  const ctx = { user: { id: "u1" } };
  await qb.create("posts", { title: "Hi", tags: ["a"] }, ctx);
  const raw = config.db.raw as DrizzleRaw<"pglite">;
  const table = raw.table("posts");
  expect(await raw.db.select({ n: count() }).from(table).where(eq(table.title!, "Hi"))).toEqual([
    { n: 1 },
  ]);
  await config.db.close?.();
});
