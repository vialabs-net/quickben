import { describe, expectTypeOf, test } from "vitest";

import {
  defineCollection,
  definePlugin,
  defineConfig,
  extendCollection,
  fields as f,
  getQuickben,
} from "../src";

import { users } from "./fixtures";

import type {
  DatabaseAdapter,
  InferCreateInput,
  InferDoc,
  InferRegistry,
  InferSort,
  InferUpdateInput,
  InferWhere,
  JsonValue,
  Plugin,
  Quickben,
  RelationField,
  RequestContext,
} from "../src";
import type { makeConfig, posts } from "./fixtures";

declare const db: DatabaseAdapter;
declare const ctx: RequestContext;

describe("InferDoc", () => {
  type Post = InferDoc<typeof posts>;

  test("system fields", () => {
    expectTypeOf<Post["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["createdAt"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["updatedAt"]>().toEqualTypeOf<string>();
  });

  test("required fields are not nullable, optional ones are", () => {
    expectTypeOf<Post["title"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["body"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["views"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Post["featured"]>().toEqualTypeOf<boolean | null>();
  });

  test("select, relation and many fields", () => {
    expectTypeOf<Post["status"]>().toEqualTypeOf<"draft" | "published">();
    expectTypeOf<Post["categories"]>().toEqualTypeOf<("news" | "tech" | "life")[]>();
    expectTypeOf<Post["author"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["tags"]>().toEqualTypeOf<string[]>();
  });

  test("dates are strings, json uses the schema", () => {
    expectTypeOf<Post["publishedOn"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["publishedAt"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Post["meta"]>().toEqualTypeOf<JsonValue | null>();
    expectTypeOf<Post["seo"]>().toEqualTypeOf<{ title: string; noIndex: boolean } | null>();
  });

  test("no extra keys", () => {
    expectTypeOf<keyof Post>().toEqualTypeOf<
      | "id"
      | "createdAt"
      | "updatedAt"
      | "title"
      | "body"
      | "status"
      | "categories"
      | "author"
      | "tags"
      | "views"
      | "featured"
      | "publishedOn"
      | "publishedAt"
      | "website"
      | "meta"
      | "seo"
    >();
  });
});

describe("InferCreateInput", () => {
  type Input = InferCreateInput<typeof posts>;

  test("required without default is required", () => {
    expectTypeOf<{ title: string }>().toExtend<Input>();
    expectTypeOf<{ body: string }>().not.toExtend<Input>();
  });

  test("defaults and optional fields are optional", () => {
    expectTypeOf<Input["status"]>().toEqualTypeOf<"draft" | "published" | undefined>();
    expectTypeOf<Input["body"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Input["tags"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<Input["id"]>().toEqualTypeOf<string | undefined>();
  });

  test("dates accept Date objects", () => {
    expectTypeOf<Input["publishedAt"]>().toEqualTypeOf<string | Date | null | undefined>();
  });
});

describe("InferUpdateInput", () => {
  type Update = InferUpdateInput<typeof posts>;

  test("every key optional, required fields not nullable", () => {
    expectTypeOf<{ body: null }>().toExtend<Update>();
    expectTypeOf<Update["title"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Update["body"]>().toEqualTypeOf<string | null | undefined>();
  });

  test("no system fields", () => {
    expectTypeOf<Update>().not.toHaveProperty("id");
    expectTypeOf<Update>().not.toHaveProperty("createdAt");
  });
});

describe("InferWhere and InferSort", () => {
  type Where = InferWhere<typeof posts>;

  test("operators depend on the field type", () => {
    expectTypeOf<{ title: { contains: "hi" } }>().toExtend<Where>();
    expectTypeOf<{ views: { gte: 10 } }>().toExtend<Where>();
    expectTypeOf<{ publishedAt: { lt: Date } }>().toExtend<Where>();
    expectTypeOf<{ status: { in: ["draft"] } }>().toExtend<Where>();
    expectTypeOf<{ tags: { contains: "t1" } }>().toExtend<Where>();
    expectTypeOf<{ meta: { exists: true } }>().toExtend<Where>();
    expectTypeOf<{ id: { eq: "x" } }>().toExtend<Where>();
  });

  test("invalid filters are rejected", () => {
    expectTypeOf<{ status: { eq: "archived" } }>().not.toExtend<Where>();
    expectTypeOf<{ views: { contains: "1" } }>().not.toExtend<Where>();
    expectTypeOf<{ featured: { gt: true } }>().not.toExtend<Where>();
    expectTypeOf<{ nope: { eq: 1 } }>().not.toExtend<Where>();
  });

  test("and / or nest", () => {
    expectTypeOf<{
      or: [{ title: { eq: "a" } }, { and: [{ views: { gt: 1 } }] }];
    }>().toExtend<Where>();
  });

  test("sort keys", () => {
    type Sort = InferSort<typeof posts>;
    expectTypeOf<"title">().toExtend<Sort>();
    expectTypeOf<"-publishedAt">().toExtend<Sort>();
    expectTypeOf<["-createdAt", "id"]>().toExtend<Sort>();
    expectTypeOf<"tags">().not.toExtend<Sort>();
    expectTypeOf<"meta">().not.toExtend<Sort>();
  });
});

declare const config: ReturnType<typeof makeConfig>;
type Qb = Quickben<InferRegistry<typeof config>>;
declare const qb: Qb;

describe("local API", () => {
  test("getQuickben returns a typed instance", () => {
    expectTypeOf(getQuickben(config)).resolves.toEqualTypeOf<Qb>();
  });

  test("slugs are checked", async () => {
    expectTypeOf<keyof InferRegistry<typeof config>>().toEqualTypeOf<"users" | "tags" | "posts">();
    // @ts-expect-error unknown collection
    await qb.find("nope", {}, ctx);
  });

  test("find returns documents of the collection", async () => {
    const page = await qb.find(
      "posts",
      { where: { status: { eq: "published" } }, sort: "-publishedAt" },
      ctx,
    );
    expectTypeOf(page.docs).toEqualTypeOf<InferDoc<typeof posts>[]>();
    expectTypeOf(page.nextCursor).toEqualTypeOf<string | null>();
  });

  test("select narrows the document", async () => {
    const page = await qb.find("posts", { select: ["title", "status"] }, ctx);
    expectTypeOf(page.docs[0]!).toEqualTypeOf<{
      id: string;
      title: string;
      status: "draft" | "published";
    }>();
  });

  test("depth populates relations", async () => {
    const post = await qb.findById("posts", "id", { depth: 1 }, ctx);
    expectTypeOf(post.author).toEqualTypeOf<string | InferDoc<typeof users> | null>();
    expectTypeOf(post.tags[0]!).toExtend<string | { label: string }>();
  });

  test("create and update inputs are checked", async () => {
    const created = await qb.create("posts", { title: "Hi" }, ctx);
    expectTypeOf(created).toEqualTypeOf<InferDoc<typeof posts>>();
    // @ts-expect-error title is required
    await qb.create("posts", { body: "x" }, ctx);
    // @ts-expect-error unknown field
    await qb.update("posts", "id", { nope: 1 }, ctx);
    // @ts-expect-error status option does not exist
    await qb.update("posts", "id", { status: "archived" }, ctx);
  });

  test("count takes a typed where", async () => {
    expectTypeOf(
      await qb.count("posts", { where: { views: { gt: 1 } } }, ctx),
    ).toEqualTypeOf<number>();
    // @ts-expect-error unknown field
    await qb.count("posts", { where: { nope: { eq: 1 } } }, ctx);
  });
});

describe("hooks and access", () => {
  test("hook data is typed from fields", () => {
    defineCollection({
      slug: "notes",
      fields: { text: f.text({ required: true }), pinned: f.boolean() },
      hooks: {
        beforeChange: [
          ({ data, operation }) => {
            if (operation === "create") expectTypeOf(data.text).toEqualTypeOf<string>();
            return data;
          },
        ],
        afterRead: [
          ({ doc }) => {
            expectTypeOf(doc.pinned).toEqualTypeOf<boolean | null>();
          },
        ],
      },
      access: {
        // @ts-expect-error unknown field in an access filter
        read: () => ({ missing: { eq: "x" } }),
      },
    });
  });

  test("field validators get the value type", () => {
    f.number({ validate: (value) => (value > 0 ? true : "Must be positive") });
    f.select({
      options: ["a", "b"],
      many: true,
      validate: (value) => {
        expectTypeOf(value).toEqualTypeOf<("a" | "b")[]>();
        return true;
      },
    });
  });
});

describe("plugins", () => {
  test("collections added by plugins join the registry", () => {
    const audit = defineCollection({
      slug: "audit",
      fields: { action: f.text({ required: true }) },
    });
    const plugin = definePlugin({ name: "audit", collections: [audit] });
    const withPlugin = defineConfig({ db, collections: [users], plugins: [plugin] });
    expectTypeOf(withPlugin).toHaveProperty("collections");
    expectTypeOf<keyof InferRegistry<typeof withPlugin>>().toEqualTypeOf<"users" | "audit">();
  });

  const notes = defineCollection({ slug: "notes", fields: { text: f.text({ required: true }) } });

  test("fields added with addFields are inferred", async () => {
    const plugin = definePlugin({
      name: "org",
      addFields: { notes: { org: f.text({ required: true, index: true }) } },
    });
    const withPlugin = defineConfig({ db, collections: [users, notes], plugins: [plugin] });
    type R = InferRegistry<typeof withPlugin>;
    type Note = InferDoc<R["notes"]>;
    expectTypeOf<Note["org"]>().toEqualTypeOf<string>();
    expectTypeOf<Note["text"]>().toEqualTypeOf<string>();
    expectTypeOf<R["users"]>().toEqualTypeOf<typeof users>();
    expectTypeOf<{ org: { eq: "o1" } }>().toExtend<InferWhere<R["notes"]>>();
    expectTypeOf<"-org">().toExtend<InferSort<R["notes"]>>();

    const typed = await getQuickben(withPlugin);
    const page = await typed.find("notes", { where: { org: { eq: "o1" } }, select: ["org"] }, ctx);
    expectTypeOf(page.docs[0]!).toEqualTypeOf<{ id: string; org: string }>();
    // @ts-expect-error org is required on create
    await typed.create("notes", { text: "x" }, ctx);
    await typed.create("notes", { text: "x", org: "o1" }, ctx);
  });

  test("extensions from several plugins merge", () => {
    const first = definePlugin({ name: "a", addFields: { notes: { a: f.number() } } });
    const second = definePlugin({ name: "b", addFields: { notes: { b: f.boolean() } } });
    const merged = defineConfig({ db, collections: [notes], plugins: [first, second] });
    expectTypeOf(merged).toHaveProperty("collections");
    type Note = InferDoc<InferRegistry<typeof merged>["notes"]>;
    expectTypeOf<Note["a"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Note["b"]>().toEqualTypeOf<boolean | null>();
  });

  test("a plugin can extend a collection added by an earlier plugin", () => {
    const audit = defineCollection({ slug: "audit", fields: { action: f.text() } });
    const adds = definePlugin({ name: "adds", collections: [audit] });
    const extends_ = definePlugin({ name: "ext", addFields: { audit: { by: f.text() } } });
    const both = defineConfig({ db, collections: [users], plugins: [adds, extends_] });
    expectTypeOf(both).toHaveProperty("collections");
    expectTypeOf<InferDoc<InferRegistry<typeof both>["audit"]>["by"]>().toEqualTypeOf<
      string | null
    >();
  });

  test("hand-written plugins declare extensions with the Plugin type", () => {
    const tagField = f.select({ options: ["a", "b"], required: true });
    expectTypeOf(tagField.type).toEqualTypeOf<"select">();
    const handWritten = ((config) => config) as Plugin<never, { notes: { tag: typeof tagField } }>;
    const withPlugin = defineConfig({ db, collections: [notes], plugins: [handWritten] });
    expectTypeOf(withPlugin).toHaveProperty("collections");
    expectTypeOf<InferDoc<InferRegistry<typeof withPlugin>["notes"]>["tag"]>().toEqualTypeOf<
      "a" | "b"
    >();
  });

  test("extendCollection on a collection is inferred", () => {
    const extended = extendCollection(notes, { fields: { pinned: f.boolean({ required: true }) } });
    const direct = defineConfig({ db, collections: [extended] });
    expectTypeOf(direct).toHaveProperty("collections");
    expectTypeOf<
      InferDoc<InferRegistry<typeof direct>["notes"]>["pinned"]
    >().toEqualTypeOf<boolean>();
  });

  test("a relation typed with a default is optional on create", () => {
    type Filled = RelationField<"users", false, true, true>;
    const owned = defineCollection({
      slug: "owned",
      fields: { owner: f.relation({ to: "users", required: true }) as unknown as Filled },
    });
    expectTypeOf(owned.slug).toEqualTypeOf<"owned">();
    expectTypeOf<InferDoc<typeof owned>["owner"]>().toEqualTypeOf<string>();
    expectTypeOf<InferCreateInput<typeof owned>["owner"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<InferCreateInput<typeof posts>>().toHaveProperty("title");
  });
});
