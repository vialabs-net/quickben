import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ConflictError,
  createQuickben,
  defineCollection,
  defineConfig,
  fields as f,
  ForbiddenError,
  getQuickben,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../src";
import { databaseSchema } from "../src/local-api";

import { makeConfig, posts, tags, users } from "./fixtures";
import { system, testAdapter } from "./helpers";

import type { QuickbenUser, RequestContext } from "../src";

const alice: QuickbenUser = { id: "alice", roles: ["admin"] };
const bob: QuickbenUser = { id: "bob" };
const as = (user: QuickbenUser | null): RequestContext => ({ user });

async function setup() {
  const db = testAdapter();
  const qb = await createQuickben(makeConfig(db));
  const author = await qb.create("users", { name: "Alice", email: "alice@example.com" }, system);
  return { db, qb, author };
}

describe("createQuickben and getQuickben", () => {
  it("passes a schema to the adapter", async () => {
    const db = testAdapter();
    await createQuickben(makeConfig(db));
    const schema = db.schema?.collections.find((c) => c.slug === "posts");
    expect(schema?.fields.find((field) => field.name === "author")).toMatchObject({
      type: "relation",
      to: "users",
    });
    expect(schema?.fields.find((field) => field.name === "status")).toMatchObject({
      options: ["draft", "published"],
    });
    expect(schema?.fields.find((field) => field.name === "views")).toMatchObject({ integer: true });
    expect(databaseSchema(makeConfig(db)).collections.map((c) => c.slug)).toEqual([
      "users",
      "tags",
      "posts",
    ]);
  });

  it("shares the cache between copies of the package", async () => {
    const config = makeConfig(testAdapter());
    const qb = await getQuickben(config);
    const store = globalThis as unknown as Record<symbol, WeakMap<object, unknown>>;
    expect(await store[Symbol.for("quickben.instances")]?.get(config)).toBe(qb);
  });

  it("caches one instance per config", async () => {
    const config = makeConfig(testAdapter());
    const [first, second] = await Promise.all([getQuickben(config), getQuickben(config)]);
    expect(first).toBe(second);
    expect(first.collections.posts.labels.plural).toBe("Posts");
    expect(first.db.name).toBe("test");
  });

  it("retries after a failed init", async () => {
    const db = testAdapter();
    const init = vi.spyOn(db, "init").mockRejectedValueOnce(new Error("down"));
    const config = makeConfig(db);
    await expect(getQuickben(config)).rejects.toThrow("down");
    await expect(getQuickben(config)).resolves.toBeDefined();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it("requires a request context", async () => {
    const { qb } = await setup();
    // @ts-expect-error missing context
    await expect(qb.find("posts", {})).rejects.toThrow(TypeError);
    // @ts-expect-error missing context
    await expect(qb.create("posts", { title: "x" })).rejects.toThrow(TypeError);
  });

  it("rejects unknown collections", async () => {
    const { qb } = await setup();
    // @ts-expect-error unknown collection
    await expect(qb.find("nope", {}, system)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("create, read, update, delete", () => {
  it("applies defaults and generates ids", async () => {
    const { qb } = await setup();
    const post = await qb.create("posts", { title: "Hi" }, system);
    expect(post).toMatchObject({
      title: "Hi",
      status: "draft",
      featured: false,
      categories: [],
      tags: [],
    });
    expect(post.createdAt).toBe(post.updatedAt);
    const second = await qb.create("posts", { title: "Two" }, system);
    expect(second.id > post.id).toBe(true);
  });

  it("calls function defaults per create", async () => {
    let counter = 0;
    const items = defineCollection({
      slug: "items",
      fields: { code: f.text({ default: () => `c${++counter}` }), list: f.json({ default: [1] }) },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [items] }));
    const a = await qb.create("items", {}, system);
    const b = await qb.create("items", {}, system);
    expect([a.code, b.code]).toEqual(["c1", "c2"]);
    expect(a.list).toEqual([1]);
  });

  it("finds by id, updates and deletes", async () => {
    const { qb } = await setup();
    const post = await qb.create("posts", { title: "Hi" }, system);
    expect(await qb.findById("posts", post.id, {}, system)).toEqual(post);
    const updated = await qb.update("posts", post.id, { title: "Hello", body: null }, system);
    expect(updated.title).toBe("Hello");
    expect(await qb.delete("posts", post.id, system)).toEqual(updated);
    await expect(qb.findById("posts", post.id, {}, system)).rejects.toBeInstanceOf(NotFoundError);
    await expect(qb.delete("posts", post.id, system)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates ids, depth, select and paging", async () => {
    const { qb } = await setup();
    await expect(qb.findById("posts", "", {}, system)).rejects.toBeInstanceOf(ValidationError);
    // @ts-expect-error depth is 0..3
    await expect(qb.find("posts", { depth: 4 }, system)).rejects.toBeInstanceOf(ValidationError);
    // @ts-expect-error unknown field
    await expect(qb.find("posts", { select: ["nope"] }, system)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // @ts-expect-error select is an array
    await expect(qb.find("posts", { select: "title" }, system)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(qb.find("posts", { page: 2, cursor: "x" }, system)).rejects.toThrow(
      /either page or cursor/,
    );
    // @ts-expect-error cursor is a string
    await expect(qb.find("posts", { cursor: 1 }, system)).rejects.toBeInstanceOf(ValidationError);
    await expect(qb.find("posts", { cursor: "bad" }, system)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("returns adapter conflicts", async () => {
    const { qb } = await setup();
    await expect(
      qb.create("users", { name: "Again", email: "alice@example.com" }, system),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("reports a document deleted during an update", async () => {
    const { qb, db } = await setup();
    const post = await qb.create("posts", { title: "Hi" }, system);
    vi.spyOn(db, "update").mockResolvedValueOnce(null);
    await expect(qb.update("posts", post.id, { title: "x" }, system)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    vi.spyOn(db, "delete").mockResolvedValueOnce(false);
    await expect(qb.delete("posts", post.id, system)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("validation", () => {
  const all = defineCollection({
    slug: "all",
    fields: {
      name: f.text({ required: true, minLength: 2, maxLength: 5 }),
      email: f.email(),
      site: f.url(),
      count: f.number({ integer: true, min: 0, max: 10 }),
      ratio: f.number({ min: 0 }),
      on: f.boolean(),
      day: f.date(),
      at: f.datetime(),
      kind: f.select({ options: ["a", "b"] }),
      kinds: f.select({ options: ["a", "b"], many: true, required: true, default: ["a"] }),
      data: f.json({ schema: z.object({ n: z.number() }) }),
      free: f.json(),
      even: f.number({ validate: (value) => (value % 2 === 0 ? true : "Must be even") }),
      code: f.text({
        validate: (value, { operation }) =>
          Promise.resolve(operation === "update" && value === "x" ? "No x" : true),
      }),
    },
    access: { create: () => true, update: () => true, read: () => true },
  });

  async function qbAll() {
    return createQuickben(defineConfig({ db: testAdapter(), collections: [all] }));
  }

  async function issues(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ValidationError) return error.issues.map((issue) => issue.path);
      throw error;
    }
    throw new Error("Expected a ValidationError");
  }

  it("normalizes dates and accepts valid data", async () => {
    const qb = await qbAll();
    const doc = await qb.create(
      "all",
      {
        name: "ok",
        email: "a@b.co",
        site: "https://example.com",
        count: 3,
        on: true,
        day: new Date("2024-05-06T22:00:00Z"),
        at: "2024-05-06T10:00:00+02:00",
        kind: "a",
        data: { n: 1 },
        free: { any: ["json", 1, null] },
        even: 2,
      },
      system,
    );
    expect(doc).toMatchObject({ day: "2024-05-06", at: "2024-05-06T08:00:00.000Z", kinds: ["a"] });
    const fromDay = await qb.create("all", { name: "ok", at: "2024-05-06" }, system);
    expect(fromDay.at).toBe("2024-05-06T00:00:00.000Z");
  });

  it("reports every invalid field", async () => {
    const qb = await qbAll();
    expect(
      await issues(
        qb.create(
          "all",
          {
            name: "x",
            email: "nope",
            site: "javascript:alert(1)",
            count: 1.5,
            ratio: -1,
            day: "2024-13-40",
            kind: "c" as "a",
            kinds: [],
            data: { n: "1" } as unknown as { n: number },
            // @ts-expect-error unknown key
            extra: 1,
          },
          system,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        "name",
        "email",
        "site",
        "count",
        "ratio",
        "day",
        "kind",
        "kinds",
        "data.n",
        "",
      ]),
    );
    expect(await issues(qb.create("all", { name: "toolong" }, system))).toEqual(["name"]);
    // @ts-expect-error name is required
    expect(await issues(qb.create("all", {}, system))).toEqual(["name"]);
    expect(await issues(qb.create("all", { name: "ok", kinds: ["a", "a"] }, system))).toEqual([
      "kinds",
    ]);
    // @ts-expect-error data is an object
    expect(await issues(qb.create("all", "nope", system))).toEqual([""]);
  });

  it("runs custom validators on present values", async () => {
    const qb = await qbAll();
    expect(await issues(qb.create("all", { name: "ok", even: 3 }, system))).toEqual(["even"]);
    const doc = await qb.create("all", { name: "ok", code: "x", even: null }, system);
    expect(await issues(qb.update("all", doc.id, { code: "x" }, system))).toEqual(["code"]);
    // @ts-expect-error name cannot be null
    expect(await issues(qb.update("all", doc.id, { name: null }, system))).toEqual(["name"]);
  });

  it("checks related ids", async () => {
    const { qb, author } = await setup();
    await expect(
      qb.create("posts", { title: "x", author: "missing" }, system),
    ).rejects.toBeInstanceOf(ValidationError);
    const tag = await qb.create("tags", { label: "t" }, system);
    const post = await qb.create(
      "posts",
      { title: "x", author: author.id, tags: [tag.id] },
      system,
    );
    expect(post.tags).toEqual([tag.id]);
  });
});

describe("access", () => {
  it("allows only authenticated users when a rule is missing", async () => {
    const notes = defineCollection({ slug: "notes", fields: { text: f.text() } });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [notes] }));
    await expect(qb.find("notes", {}, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(qb.create("notes", { text: "x" }, as(null))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const note = await qb.create("notes", { text: "x" }, as(bob));
    expect((await qb.find("notes", {}, as(bob))).docs).toHaveLength(1);
    await expect(qb.delete("notes", note.id, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("combines read filters with the query", async () => {
    const secrets = defineCollection({
      slug: "secrets",
      fields: { owner: f.text({ required: true }) },
      access: {
        read: ({ user }) => (user ? { owner: { eq: user.id } } : false),
        create: () => true,
      },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [secrets] }));
    const mine = await qb.create("secrets", { owner: "bob" }, as(bob));
    await qb.create("secrets", { owner: "alice" }, as(bob));
    expect((await qb.find("secrets", {}, as(bob))).docs.map((doc) => doc.id)).toEqual([mine.id]);
    expect(await qb.count("secrets", {}, as(bob))).toBe(1);
    expect(await qb.count("secrets", {}, system)).toBe(2);
    await expect(qb.findById("secrets", mine.id, {}, as(alice))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(qb.count("secrets", {}, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("checks update and delete filters against the stored document", async () => {
    const { qb, author } = await setup();
    const post = await qb.create("posts", { title: "Mine", author: author.id }, system);
    const owner: QuickbenUser = { id: author.id };
    await expect(qb.update("posts", post.id, { title: "x" }, as(bob))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(qb.update("posts", post.id, { title: "x" }, as(null))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect((await qb.update("posts", post.id, { title: "Ok" }, as(owner))).title).toBe("Ok");
    await expect(qb.delete("posts", post.id, as(owner))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await qb.delete("posts", post.id, as(alice))).id).toBe(post.id);
  });

  it("checks create filters against the new document", async () => {
    const scoped = defineCollection({
      slug: "scoped",
      fields: { team: f.text() },
      access: { create: () => ({ team: { eq: "red" } }), read: () => true },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [scoped] }));
    expect((await qb.create("scoped", { team: "red" }, as(bob))).team).toBe("red");
    await expect(qb.create("scoped", { team: "blue" }, as(bob))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(qb.create("scoped", { team: "blue" }, system)).resolves.toBeDefined();
  });

  it("keeps updated documents inside the update filter", async () => {
    const teams = defineCollection({
      slug: "teams",
      fields: { team: f.text({ required: true }), note: f.text() },
      access: {
        read: () => true,
        create: () => true,
        update: ({ user }) => (user ? { team: { eq: user.id } } : false),
      },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [teams] }));
    const doc = await qb.create("teams", { team: "bob" }, system);
    expect((await qb.update("teams", doc.id, { note: "ok" }, as(bob))).note).toBe("ok");
    await expect(qb.update("teams", doc.id, { team: "alice" }, as(bob))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await qb.findById("teams", doc.id, {}, system)).team).toBe("bob");
  });

  it("reports unreadable documents as not found on update and delete", async () => {
    const secrets = defineCollection({
      slug: "secrets",
      fields: { owner: f.text({ required: true }) },
      access: {
        read: ({ user }) => (user ? { owner: { eq: user.id } } : false),
        update: () => true,
        delete: () => true,
      },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [secrets] }));
    const other = await qb.create("secrets", { owner: "alice" }, system);
    await expect(qb.update("secrets", other.id, { owner: "bob" }, as(bob))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(qb.delete("secrets", other.id, as(bob))).rejects.toBeInstanceOf(NotFoundError);
    // No read access at all: denied, whether the document exists or not.
    await expect(qb.delete("secrets", other.id, as(null))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(qb.delete("secrets", "missing", as(null))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(await qb.count("secrets", {}, system)).toBe(1);
  });

  it("only links to related documents the user can read", async () => {
    const secrets = defineCollection({
      slug: "secrets",
      fields: { owner: f.text({ required: true }) },
      access: { read: ({ user }) => (user ? { owner: { eq: user.id } } : false) },
    });
    const hidden = defineCollection({ slug: "hidden", fields: {}, access: { read: () => false } });
    const links = defineCollection({
      slug: "links",
      fields: { secret: f.relation({ to: "secrets" }), hidden: f.relation({ to: "hidden" }) },
      access: { read: () => true, create: () => true },
    });
    const qb = await createQuickben(
      defineConfig({ db: testAdapter(), collections: [secrets, hidden, links] }),
    );
    const mine = await qb.create("secrets", { owner: "bob" }, system);
    const theirs = await qb.create("secrets", { owner: "alice" }, system);
    const invisible = await qb.create("hidden", {}, system);
    expect((await qb.create("links", { secret: mine.id }, as(bob))).secret).toBe(mine.id);
    await expect(qb.create("links", { secret: theirs.id }, as(bob))).rejects.toMatchObject({
      issues: [{ path: "secret", message: `No "secrets" document with id "${theirs.id}"` }],
    });
    await expect(qb.create("links", { hidden: invisible.id }, as(bob))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const linked = await qb.create("links", { secret: theirs.id }, system);
    // Ids the document already stores can be sent back unchanged, even when unreadable.
    expect((await qb.update("links", linked.id, { secret: theirs.id }, as(bob))).secret).toBe(
      theirs.id,
    );
    await expect(
      qb.update("links", linked.id, { hidden: invisible.id }, as(bob)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes the request details to access functions", async () => {
    const seen: unknown[] = [];
    const logged = defineCollection({
      slug: "logged",
      fields: { a: f.text() },
      access: {
        create: (args) => {
          seen.push(args);
          return true;
        },
        read: () => true,
      },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [logged] }));
    const req = new Request("https://example.com");
    const ctx = { user: bob, req };
    await qb.create("logged", { a: "x" }, ctx);
    expect(seen).toEqual([
      {
        user: bob,
        req,
        ctx,
        qb: expect.objectContaining({ find: expect.any(Function) as unknown }) as unknown,
        operation: "create",
        id: undefined,
        data: { a: "x" },
      },
    ]);
  });

  it("passes the whole context, with plugin keys, to access rules and hooks", async () => {
    const seen: unknown[] = [];
    const tagOf = (ctx: object) => (ctx as { tag?: string }).tag;
    const tagged = defineCollection({
      slug: "tagged",
      fields: { a: f.text() },
      access: {
        read: ({ ctx, qb }) => {
          seen.push(["access", tagOf(ctx), typeof qb?.find]);
          return true;
        },
        create: () => true,
      },
      hooks: {
        beforeChange: [
          ({ ctx }) => {
            seen.push(["beforeChange", tagOf(ctx)]);
          },
        ],
        afterRead: [
          ({ ctx }) => {
            seen.push(["afterRead", tagOf(ctx)]);
          },
        ],
      },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [tagged] }));
    const ctx = { user: bob, tag: "t1" };
    await qb.create("tagged", { a: "x" }, ctx);
    await qb.find("tagged", {}, ctx);
    expect(seen).toEqual([
      ["beforeChange", "t1"],
      ["afterRead", "t1"],
      ["access", "t1", "function"],
      ["afterRead", "t1"],
    ]);
  });

  it("keeps unreadable relations as ids", async () => {
    const { qb, author } = await setup();
    const hidden = defineCollection({ slug: "hidden", fields: {}, access: { read: () => false } });
    const refs = defineCollection({
      slug: "refs",
      fields: { to: f.relation({ to: "hidden" }) },
      access: { read: () => true },
    });
    const other = await createQuickben(
      defineConfig({ db: testAdapter(), collections: [hidden, refs] }),
    );
    const target = await other.create("hidden", {}, system);
    const ref = await other.create("refs", { to: target.id }, system);
    expect((await other.findById("refs", ref.id, { depth: 1 }, { user: bob })).to).toBe(target.id);
    expect((await other.findById("refs", ref.id, { depth: 1 }, system)).to).toMatchObject({
      id: target.id,
    });
    const post = await qb.create("posts", { title: "x", author: author.id }, system);
    expect(
      (await qb.findById("posts", post.id, { depth: 1 }, { user: null })).author,
    ).toMatchObject({
      name: "Alice",
    });
  });
});

describe("hooks", () => {
  const calls: string[] = [];
  const hooked = defineCollection({
    slug: "hooked",
    fields: { title: f.text({ required: true }), slug: f.text(), secret: f.text() },
    access: { read: () => true, create: () => true, update: () => true, delete: () => true },
    hooks: {
      beforeValidate: [
        ({ data, operation }) => {
          calls.push(`beforeValidate:${operation}`);
          if (typeof data.title === "string") return { ...data, title: data.title.trim() };
          return undefined;
        },
      ],
      beforeChange: [
        ({ data, operation, original }) => {
          calls.push(`beforeChange:${operation}:${original ? "with" : "without"}-original`);
          if (data.title) return { ...data, slug: data.title.toLowerCase() };
          return undefined;
        },
      ],
      afterChange: [
        async ({ doc, qb, operation }) => {
          calls.push(`afterChange:${operation}`);
          if (doc.title === "spawn")
            await qb.create(
              "logs",
              { text: `created ${doc.id}` },
              { user: null, overrideAccess: true },
            );
        },
      ],
      afterRead: [({ doc }) => ({ ...doc, secret: null })],
      beforeDelete: [
        ({ doc }) => {
          calls.push("beforeDelete");
          if (doc.title === "keep") throw new Error("Cannot delete");
        },
      ],
      afterDelete: [
        ({ id }) => {
          calls.push(`afterDelete:${id}`);
        },
      ],
    },
  });
  const logs = defineCollection({
    slug: "logs",
    fields: { text: f.text() },
    access: { read: () => true },
  });

  beforeEach(() => {
    calls.length = 0;
  });

  async function qbHooked() {
    return createQuickben(defineConfig({ db: testAdapter(), collections: [hooked, logs] }));
  }

  it("run in order and can change data", async () => {
    const qb = await qbHooked();
    const doc = await qb.create("hooked", { title: "  Hello  ", secret: "s" }, system);
    expect(doc).toMatchObject({ title: "Hello", slug: "hello", secret: null });
    await qb.update("hooked", doc.id, { title: "Bye" }, system);
    await qb.delete("hooked", doc.id, system);
    expect(calls).toEqual([
      "beforeValidate:create",
      "beforeChange:create:without-original",
      "afterChange:create",
      "beforeValidate:update",
      "beforeChange:update:with-original",
      "afterChange:update",
      "beforeDelete",
      `afterDelete:${doc.id}`,
    ]);
  });

  it("afterRead sees full documents when select is used", async () => {
    const qb = await qbHooked();
    await qb.create("hooked", { title: "One", secret: "s" }, system);
    const page = await qb.find("hooked", { select: ["title", "secret"] }, system);
    expect(page.docs.map((doc) => [doc.title, doc.secret, Object.keys(doc)])).toEqual([
      ["One", null, ["id", "title", "secret"]],
    ]);
  });

  it("get a local API bound to the transaction", async () => {
    const qb = await qbHooked();
    await qb.create("hooked", { title: "spawn" }, system);
    expect(await qb.count("logs", {}, system)).toBe(1);
  });

  it("can cancel a delete", async () => {
    const qb = await qbHooked();
    const doc = await qb.create("hooked", { title: "keep" }, system);
    await expect(qb.delete("hooked", doc.id, system)).rejects.toThrow("Cannot delete");
    expect(await qb.count("hooked", {}, system)).toBe(1);
  });
});

describe("relations", () => {
  it("populates one level per depth", async () => {
    const { qb, author } = await setup();
    const tag = await qb.create("tags", { label: "t" }, system);
    const post = await qb.create(
      "posts",
      { title: "x", author: author.id, tags: [tag.id] },
      system,
    );
    const loaded = await qb.findById("posts", post.id, { depth: 1 }, system);
    expect(loaded.author).toMatchObject({ id: author.id, name: "Alice" });
    expect(loaded.tags).toMatchObject([{ id: tag.id, label: "t" }]);
    const selected = await qb.findById("posts", post.id, { depth: 1, select: ["title"] }, system);
    expect(selected).toEqual({ id: post.id, title: "x" });
  });

  it("uses one query per related collection", async () => {
    const { qb, db, author } = await setup();
    await qb.create("posts", { title: "a", author: author.id }, system);
    await qb.create("posts", { title: "b", author: author.id }, system);
    const find = vi.spyOn(db, "find");
    await qb.find("posts", { depth: 1 }, system);
    expect(find.mock.calls.map((call) => call[0].collection)).toEqual(["posts", "users"]);
  });
});

describe("transactions", () => {
  it("roll back on error", async () => {
    const { qb } = await setup();
    await expect(
      qb.transaction(async (tx) => {
        await tx.create("tags", { label: "a" }, system);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await qb.count("tags", {}, system)).toBe(0);
    expect(tags.slug).toBe("tags");
    expect(users.slug).toBe("users");
    expect(posts.slug).toBe("posts");
  });
});
