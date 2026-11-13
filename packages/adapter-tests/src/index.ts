import { createQuickben } from "@quickben/core";
import { beforeEach, describe, expect, it } from "vitest";

import { contractConfig } from "./fixtures";

import type { posts } from "./fixtures";
import type {
  DatabaseAdapter,
  InferCreateInput,
  InferRegistry,
  InferSort,
  InferWhere,
  Quickben,
  RequestContext,
} from "@quickben/core";

type Qb = Quickben<InferRegistry<ReturnType<typeof contractConfig>>>;
type PostWhere = InferWhere<typeof posts>;
type PostSort = InferSort<typeof posts>;

const system: RequestContext = { user: null, overrideAccess: true };

type PostTitle = "Alpha" | "beta" | "Gamma ray" | "delta" | "Epsilon";
type Ids = Record<"t1" | "t2" | "t3" | "a1" | "a2" | PostTitle, string>;

interface Seed {
  qb: Qb;
  db: DatabaseAdapter;
  ids: Ids;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : 1);

async function seed(db: DatabaseAdapter): Promise<Seed> {
  const qb: Qb = await createQuickben(contractConfig(db));
  const ids = {} as Ids;
  const t1 = await qb.create("tags", { label: "one" }, system);
  const t2 = await qb.create("tags", { label: "two" }, system);
  const t3 = await qb.create("tags", { label: "three" }, system);
  const a1 = await qb.create(
    "authors",
    { name: "Ada", email: "ada@example.com", favoriteTag: t1.id },
    system,
  );
  const a2 = await qb.create("authors", { name: "Bob", email: "bob@example.com" }, system);
  Object.assign(ids, { t1: t1.id, t2: t2.id, t3: t3.id, a1: a1.id, a2: a2.id });
  const rows: InferCreateInput<typeof posts>[] = [
    {
      title: "Alpha",
      slug: "alpha",
      views: 10,
      rating: 4.5,
      published: true,
      status: "published",
      categories: ["news", "tech"],
      publishedOn: "2024-01-10",
      publishedAt: "2024-01-10T10:00:00.000Z",
      author: a1.id,
      tags: [t1.id, t2.id],
      meta: { nested: { list: [1, 2] }, flag: true },
    },
    {
      title: "beta",
      slug: "beta",
      views: 5,
      published: false,
      status: "draft",
      categories: ["tech"],
      author: a2.id,
      tags: [t2.id],
    },
    {
      title: "Gamma ray",
      rating: 3,
      published: true,
      status: "archived",
      publishedOn: "2023-12-31",
      publishedAt: "2023-12-31T23:59:59.000Z",
      meta: { b: 2 },
    },
    {
      title: "delta",
      slug: "delta",
      views: 20,
      rating: 5,
      categories: ["life"],
      publishedOn: "2024-02-01",
      publishedAt: "2024-02-01T00:00:00.000Z",
      author: a1.id,
      tags: [t1.id],
    },
    {
      title: "Epsilon",
      slug: "epsilon",
      views: 5,
      rating: 1.5,
      published: false,
      status: "published",
      categories: ["news"],
      publishedOn: "2024-01-20",
      publishedAt: "2024-01-20T08:30:00.000Z",
      author: a2.id,
      tags: [t3.id],
    },
  ];
  for (const row of rows) {
    const doc = await qb.create("posts", row, system);
    ids[doc.title as PostTitle] = doc.id;
  }
  return { qb, db, ids };
}

/**
 * Run the adapter contract suite. `createAdapter` must return a new, empty adapter for each
 * test. Call it at the top level of a Vitest test file.
 */
export function runAdapterContractTests(
  createAdapter: () => DatabaseAdapter | Promise<DatabaseAdapter>,
): void {
  describe("database adapter contract", () => {
    let qb: Qb;
    let db: DatabaseAdapter;
    let ids: Ids;

    beforeEach(async () => {
      ({ qb, db, ids } = await seed(await createAdapter()));
    });

    async function titles(where: PostWhere, sort: PostSort = "title") {
      const result = await qb.find("posts", { where, sort, limit: 100 }, system);
      return result.docs.map((doc) => doc.title).sort(byCodeUnit);
    }

    describe("create and read", () => {
      it("returns documents with system fields and every field", async () => {
        const doc = await qb.findById("posts", ids.Alpha, system);
        expect(doc.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(doc).toMatchObject({
          title: "Alpha",
          views: 10,
          rating: 4.5,
          published: true,
          categories: ["news", "tech"],
          publishedOn: "2024-01-10",
          publishedAt: "2024-01-10T10:00:00.000Z",
          tags: [ids.t1, ids.t2],
          meta: { nested: { list: [1, 2] }, flag: true },
        });
      });

      it("returns null and empty arrays for unset fields", async () => {
        const doc = await qb.findById("posts", ids["Gamma ray"], system);
        expect(doc).toMatchObject({
          slug: null,
          views: null,
          body: null,
          author: null,
          tags: [],
          categories: [],
        });
      });

      it("keeps a custom id", async () => {
        const doc = await qb.create("tags", { id: "custom-id", label: "x" }, system);
        expect(doc.id).toBe("custom-id");
        await expect(
          qb.create("tags", { id: "custom-id", label: "y" }, system),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });

      it("findOne returns null when nothing matches", async () => {
        expect(
          await db.findOne({
            collection: "posts",
            where: { field: "id", op: "eq", value: "missing" },
          }),
        ).toBeNull();
      });
    });

    describe("update and delete", () => {
      it("merges changes and keeps other fields", async () => {
        const before = await qb.findById("posts", ids.beta, system);
        const after = await qb.update("posts", ids.beta, { views: 6, body: "text" }, system);
        expect(after).toMatchObject({ title: "beta", views: 6, body: "text", tags: [ids.t2] });
        expect(after.createdAt).toBe(before.createdAt);
        expect(after.updatedAt >= before.updatedAt).toBe(true);
      });

      it("clears values with null", async () => {
        const after = await qb.update("posts", ids.Alpha, { slug: null, tags: [] }, system);
        expect(after).toMatchObject({ slug: null, tags: [] });
      });

      it("deletes documents", async () => {
        const deleted = await qb.delete("posts", ids.delta, system);
        expect(deleted.title).toBe("delta");
        await expect(qb.findById("posts", ids.delta, system)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect(await qb.count("posts", {}, system)).toBe(4);
      });

      it("reports missing documents", async () => {
        expect(
          await db.update({ collection: "posts", id: "missing", data: { views: 1 } }),
        ).toBeNull();
        expect(await db.delete({ collection: "posts", id: "missing" })).toBe(false);
        await expect(qb.update("posts", "missing", { views: 1 }, system)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });
    });

    describe("unique values", () => {
      it("rejects a taken value on create and update", async () => {
        await expect(
          qb.create("posts", { title: "x", slug: "alpha" }, system),
        ).rejects.toMatchObject({
          code: "CONFLICT",
        });
        await expect(qb.update("posts", ids.beta, { slug: "alpha" }, system)).rejects.toMatchObject(
          {
            code: "CONFLICT",
          },
        );
      });

      it("allows several nulls and keeping the own value", async () => {
        await qb.create("posts", { title: "no slug" }, system);
        await expect(
          qb.update("posts", ids.Alpha, { slug: "alpha", views: 11 }, system),
        ).resolves.toMatchObject({
          views: 11,
        });
      });
    });

    describe("where operators", () => {
      it("eq and ne (ne matches null)", async () => {
        expect(await titles({ status: { eq: "published" } })).toEqual(["Alpha", "Epsilon"]);
        expect(await titles({ status: { ne: "published" } })).toEqual([
          "Gamma ray",
          "beta",
          "delta",
        ]);
      });

      it("in and notIn (notIn matches null)", async () => {
        expect(await titles({ views: { in: [5, 20] } })).toEqual(["Epsilon", "beta", "delta"]);
        expect(await titles({ views: { notIn: [5] } })).toEqual(["Alpha", "Gamma ray", "delta"]);
        expect(await titles({ views: { in: [] } })).toEqual([]);
      });

      it("lt, lte, gt, gte (never match null)", async () => {
        expect(await titles({ views: { lt: 10 } })).toEqual(["Epsilon", "beta"]);
        expect(await titles({ views: { lte: 10 } })).toEqual(["Alpha", "Epsilon", "beta"]);
        expect(await titles({ rating: { gt: 3 } })).toEqual(["Alpha", "delta"]);
        expect(await titles({ rating: { gte: 3 } })).toEqual(["Alpha", "Gamma ray", "delta"]);
      });

      it("contains and startsWith ignore case", async () => {
        expect(await titles({ title: { contains: "ALP" } })).toEqual(["Alpha"]);
        expect(await titles({ title: { contains: "a" } })).toEqual([
          "Alpha",
          "Gamma ray",
          "beta",
          "delta",
        ]);
        expect(await titles({ title: { startsWith: "e" } })).toEqual(["Epsilon"]);
        expect(await titles({ title: { startsWith: "GAM" } })).toEqual(["Gamma ray"]);
      });

      it("exists", async () => {
        expect(await titles({ slug: { exists: false } })).toEqual(["Gamma ray"]);
        expect(await titles({ slug: { exists: true } })).toHaveLength(4);
        expect(await titles({ meta: { exists: true } })).toEqual(["Alpha", "Gamma ray"]);
      });

      it("dates and datetimes", async () => {
        expect(await titles({ publishedOn: { gte: "2024-01-01" } })).toEqual([
          "Alpha",
          "Epsilon",
          "delta",
        ]);
        expect(await titles({ publishedAt: { lt: new Date("2024-01-15T00:00:00Z") } })).toEqual([
          "Alpha",
          "Gamma ray",
        ]);
        expect(await titles({ createdAt: { lte: new Date() } })).toHaveLength(5);
      });

      it("booleans", async () => {
        expect(await titles({ published: { eq: true } })).toEqual(["Alpha", "Gamma ray"]);
        expect(await titles({ published: { ne: true } })).toEqual(["Epsilon", "beta", "delta"]);
      });

      it("array fields", async () => {
        expect(await titles({ categories: { contains: "tech" } })).toEqual(["Alpha", "beta"]);
        expect(await titles({ categories: { in: ["life", "news"] } })).toEqual([
          "Alpha",
          "Epsilon",
          "delta",
        ]);
        expect(await titles({ categories: { notIn: ["news"] } })).toEqual([
          "Gamma ray",
          "beta",
          "delta",
        ]);
        expect(await titles({ categories: { exists: false } })).toEqual(["Gamma ray"]);
        expect(await titles({ tags: { contains: ids.t2 } })).toEqual(["Alpha", "beta"]);
      });

      it("relations and ids", async () => {
        expect(await titles({ author: { eq: ids.a1 } })).toEqual(["Alpha", "delta"]);
        expect(await titles({ author: { exists: false } })).toEqual(["Gamma ray"]);
        expect(await titles({ id: { in: [ids.Alpha, ids.delta] } })).toEqual(["Alpha", "delta"]);
      });

      it("and, or and several keys", async () => {
        expect(await titles({ or: [{ status: { eq: "draft" } }, { views: { gt: 15 } }] })).toEqual([
          "beta",
          "delta",
        ]);
        expect(await titles({ and: [{ published: { eq: true } }, { rating: { gt: 4 } }] })).toEqual(
          ["Alpha"],
        );
        expect(await titles({ published: { eq: false }, views: { eq: 5 } })).toEqual([
          "Epsilon",
          "beta",
        ]);
        expect(
          await titles({
            or: [
              { and: [{ views: { gte: 10 } }, { rating: { lt: 5 } }] },
              { title: { startsWith: "gam" } },
            ],
          }),
        ).toEqual(["Alpha", "Gamma ray"]);
      });

      it("empty and matches all, empty or matches none", async () => {
        expect(await titles({ and: [] })).toHaveLength(5);
        expect(await titles({ or: [] })).toEqual([]);
      });
    });

    describe("sort", () => {
      async function order(sort: PostSort | undefined) {
        const result = await qb.find("posts", { sort, limit: 100 }, system);
        return result.docs.map((doc) => doc.title);
      }

      it("ascending puts nulls last", async () => {
        expect(await order("slug")).toEqual(["Alpha", "beta", "delta", "Epsilon", "Gamma ray"]);
        expect(await order("views")).toEqual(["beta", "Epsilon", "Alpha", "delta", "Gamma ray"]);
      });

      it("descending puts nulls first and breaks ties by id", async () => {
        expect(await order("-views")).toEqual(["Gamma ray", "delta", "Alpha", "Epsilon", "beta"]);
      });

      it("several keys", async () => {
        expect(await order(["status", "-views"])).toEqual([
          "Gamma ray",
          "beta",
          "Alpha",
          "Epsilon",
          "delta",
        ]);
      });

      it("defaults to newest first", async () => {
        expect(await order(undefined)).toEqual(["Epsilon", "delta", "Gamma ray", "beta", "Alpha"]);
      });
    });

    describe("pagination", () => {
      it("limit and page", async () => {
        const first = await qb.find("posts", { sort: "slug", limit: 2 }, system);
        expect(first.docs.map((doc) => doc.slug)).toEqual(["alpha", "beta"]);
        expect(first).toMatchObject({
          page: 1,
          totalDocs: 5,
          totalPages: 3,
          hasNextPage: true,
          limit: 2,
        });
        const last = await qb.find("posts", { sort: "slug", limit: 2, page: 3 }, system);
        expect(last.docs.map((doc) => doc.title)).toEqual(["Gamma ray"]);
        expect(last).toMatchObject({ hasNextPage: false, nextCursor: null });
        const beyond = await qb.find("posts", { sort: "slug", limit: 2, page: 4 }, system);
        expect(beyond.docs).toEqual([]);
      });

      it.each([
        ["slug"],
        ["-views"],
        ["views"],
        ["-publishedAt"],
        ["published"],
        [["status", "-views"]],
        [undefined],
      ] as const)("cursor walks every document once (sort %j)", async (sort) => {
        const all = await qb.find("posts", { sort, limit: 100 }, system);
        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
          const result = await qb.find(
            "posts",
            { sort, limit: 2, ...(cursor ? { cursor } : {}) },
            system,
          );
          seen.push(...result.docs.map((doc) => doc.id));
          if (cursor) expect(result).toMatchObject({ page: null, totalDocs: null });
          if (!result.nextCursor) break;
          cursor = result.nextCursor;
        }
        expect(seen).toEqual(all.docs.map((doc) => doc.id));
      });

      it("count applies the filter", async () => {
        expect(await qb.count("posts", { where: { published: { eq: true } } }, system)).toBe(2);
        expect(await qb.count("posts", {}, system)).toBe(5);
      });
    });

    describe("select", () => {
      it("returns only the selected fields and id", async () => {
        const result = await qb.find(
          "posts",
          { select: ["title"], sort: "slug", limit: 1 },
          system,
        );
        expect(result.docs).toEqual([{ id: ids.Alpha, title: "Alpha" }]);
        const raw = await db.find({ collection: "posts", select: ["views"], limit: 1 });
        expect(Object.keys(raw[0] ?? {}).sort(byCodeUnit)).toEqual(["id", "views"]);
      });
    });

    describe("relations", () => {
      it("depth 0 returns ids", async () => {
        const post = await qb.findById("posts", ids.Alpha, system);
        expect(post.author).toBe(ids.a1);
      });

      it("depth 1 loads related documents", async () => {
        const post = await qb.findById("posts", ids.Alpha, { ...system, depth: 1 });
        expect(post.author).toMatchObject({ id: ids.a1, name: "Ada", favoriteTag: ids.t1 });
        expect(post.tags).toMatchObject([{ label: "one" }, { label: "two" }]);
      });

      it("depth 2 loads nested relations", async () => {
        const result = await qb.find(
          "posts",
          { where: { author: { exists: true } }, depth: 2, limit: 10 },
          system,
        );
        const alpha = result.docs.find((doc) => doc.id === ids.Alpha);
        expect(alpha?.author).toMatchObject({ name: "Ada", favoriteTag: { label: "one" } });
      });

      it("missing related documents stay ids", async () => {
        await db.delete({ collection: "authors", id: ids.a2 });
        const post = await qb.findById("posts", ids.beta, { ...system, depth: 1 });
        expect(post.author).toBe(ids.a2);
      });

      it("rejects unknown related ids", async () => {
        await expect(
          qb.create("posts", { title: "x", author: "missing" }, system),
        ).rejects.toMatchObject({
          code: "VALIDATION",
        });
        await expect(
          qb.update("posts", ids.beta, { tags: [ids.t1, "missing"] }, system),
        ).rejects.toMatchObject({
          code: "VALIDATION",
        });
      });
    });

    describe("transactions", () => {
      it("commits all writes", async () => {
        await qb.transaction(async (tx) => {
          await tx.create("tags", { label: "a" }, system);
          await tx.create("tags", { label: "b" }, system);
        });
        expect(await qb.count("tags", {}, system)).toBe(5);
      });

      it("rolls back every write when the function throws", async () => {
        await expect(
          qb.transaction(async (tx) => {
            await tx.create("tags", { label: "a" }, system);
            await tx.update("posts", ids.Alpha, { views: 99 }, system);
            await tx.delete("posts", ids.beta, system);
            throw new Error("stop");
          }),
        ).rejects.toThrow("stop");
        expect(await qb.count("tags", {}, system)).toBe(3);
        expect((await qb.findById("posts", ids.Alpha, system)).views).toBe(10);
        expect(await qb.count("posts", {}, system)).toBe(5);
      });

      it("rolls back a write when a hook throws", async () => {
        await expect(qb.create("logs", { message: "fail" }, system)).rejects.toThrow(
          "afterChange failed",
        );
        expect(await qb.count("logs", {}, system)).toBe(0);
        await qb.create("logs", { message: "ok" }, system);
        expect(await qb.count("logs", {}, system)).toBe(1);
      });

      it("reads its own writes and joins nested transactions", async () => {
        // Adapters may store timestamps in native types, so they get valid ISO strings.
        const now = new Date().toISOString();
        await db.transaction(async (tx) => {
          await tx.create({
            collection: "tags",
            data: { id: "tx-1", label: "x", createdAt: now, updatedAt: now },
          });
          expect(
            await tx.findOne({
              collection: "tags",
              where: { field: "id", op: "eq", value: "tx-1" },
            }),
          ).not.toBeNull();
          await tx.transaction(async (inner) => {
            await inner.delete({ collection: "tags", id: ids.t3 });
          });
          expect(await tx.count({ collection: "tags" })).toBe(3);
        });
        expect(await db.count({ collection: "tags" })).toBe(3);
      });
    });
  });
}
