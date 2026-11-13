import { describe, expect, it } from "vitest";

import {
  ConfigError,
  createQuickben,
  defineCollection,
  defineConfig,
  definePlugin,
  extendCollection,
  fields as f,
} from "../src";

import { testAdapter } from "./helpers";

import type { Plugin } from "../src";

describe("fields", () => {
  it("fills option defaults", () => {
    expect(f.text()).toMatchObject({
      type: "text",
      required: false,
      many: false,
      unique: false,
      index: false,
      default: undefined,
      admin: {},
    });
  });

  it("keeps type specific options", () => {
    expect(f.number({ integer: true, min: 1, max: 9 })).toMatchObject({
      integer: true,
      min: 1,
      max: 9,
    });
    expect(f.select({ options: ["a", "b"], many: true })).toMatchObject({
      options: ["a", "b"],
      many: true,
    });
    expect(f.relation({ to: "users", required: true })).toMatchObject({
      to: "users",
      required: true,
    });
    expect(f.email({ maxLength: 5 })).toMatchObject({ type: "email", maxLength: 5 });
    expect(f.json().schema).toBeUndefined();
  });

  it("covers every factory", () => {
    const types = [
      f.text(),
      f.textarea(),
      f.email(),
      f.url(),
      f.number(),
      f.boolean(),
      f.date(),
      f.datetime(),
      f.select({ options: ["x"] }),
      f.relation({ to: "x" }),
      f.json(),
    ].map((field) => field.type);
    expect(types).toEqual([
      "text",
      "textarea",
      "email",
      "url",
      "number",
      "boolean",
      "date",
      "datetime",
      "select",
      "relation",
      "json",
    ]);
  });
});

describe("defineCollection", () => {
  it("derives labels from the slug", () => {
    expect(defineCollection({ slug: "blog-posts", fields: {} }).labels).toEqual({
      singular: "Blog post",
      plural: "Blog posts",
    });
    expect(defineCollection({ slug: "categories", fields: {} }).labels.singular).toBe("Category");
    expect(defineCollection({ slug: "access", fields: {} }).labels.singular).toBe("Access");
    expect(defineCollection({ slug: "staff", fields: {} }).labels.singular).toBe("Staff");
    expect(defineCollection({ slug: "x", labels: { singular: "One" }, fields: {} }).labels).toEqual(
      {
        singular: "One",
        plural: "X",
      },
    );
  });

  it("rejects invalid slugs and field names", () => {
    expect(() => defineCollection({ slug: "Posts", fields: {} })).toThrow(ConfigError);
    expect(() => defineCollection({ slug: "p", fields: { "bad-name": f.text() } })).toThrow(
      /Invalid field name/,
    );
    expect(() => defineCollection({ slug: "p", fields: { id: f.text() } })).toThrow(/reserved/);
    expect(() => defineCollection({ slug: "p", fields: { or: f.text() } })).toThrow(/reserved/);
  });

  it("rejects unique many fields and empty selects", () => {
    expect(() =>
      defineCollection({
        slug: "p",
        fields: { tags: f.relation({ to: "t", many: true, unique: true }) },
      }),
    ).toThrow(/unique and many/);
    const empty = { ...f.select({ options: ["a"] }), options: [] };
    expect(() => defineCollection({ slug: "p", fields: { s: empty } })).toThrow(
      /at least one option/,
    );
  });
});

describe("extendCollection", () => {
  const base = defineCollection({
    slug: "posts",
    fields: { title: f.text() },
    hooks: { beforeChange: [({ data }) => data] },
  });

  it("adds fields and appends hooks", () => {
    const extended = extendCollection(base, {
      fields: { owner: f.text() },
      hooks: { beforeChange: [({ data }) => data], afterRead: [() => undefined] },
    });
    expect(Object.keys(extended.fields)).toEqual(["title", "owner"]);
    expect(extended.hooks.beforeChange).toHaveLength(2);
    expect(extended.hooks.afterRead).toHaveLength(1);
    expect(base.hooks.beforeChange).toHaveLength(1);
    expect(extendCollection(base, {}).fields).toEqual(base.fields);
  });

  it("rejects duplicate or invalid fields", () => {
    expect(() => extendCollection(base, { fields: { title: f.text() } })).toThrow(/already exists/);
    expect(() => extendCollection(base, { fields: { createdAt: f.text() } })).toThrow(/reserved/);
  });
});

describe("defineConfig", () => {
  const users = defineCollection({ slug: "users", fields: { name: f.text() } });

  it("sanitizes collections", () => {
    const config = defineConfig({ db: testAdapter(), collections: [users] });
    expect(config.admin).toEqual({ title: "Quickben" });
    expect(config.collections[0]?.fieldList).toMatchObject([
      { name: "name", label: "Name", type: "text" },
    ]);
  });

  it("rejects duplicate slugs and unknown relations", () => {
    expect(() => defineConfig({ db: testAdapter(), collections: [users, users] })).toThrow(
      /Duplicate collection/,
    );
    const posts = defineCollection({
      slug: "posts",
      fields: { author: f.relation({ to: "people" }) },
    });
    expect(() => defineConfig({ db: testAdapter(), collections: [posts] })).toThrow(
      /unknown collection "people"/,
    );
  });

  it("checks modules", () => {
    const sales = { key: "sales", label: "Sales", collections: ["users"] };
    expect(
      defineConfig({ db: testAdapter(), collections: [users], modules: [sales] }).modules,
    ).toEqual([sales]);
    expect(() =>
      defineConfig({ db: testAdapter(), collections: [users], modules: [sales, sales] }),
    ).toThrow(/Duplicate module/);
    expect(() =>
      defineConfig({
        db: testAdapter(),
        collections: [users],
        modules: [{ key: "crm", label: "CRM", collections: ["leads"] }],
      }),
    ).toThrow(/unknown collection "leads"/);
  });
});

describe("plugins", () => {
  const users = defineCollection({ slug: "users", fields: { name: f.text() } });
  const audit = defineCollection({ slug: "audit", fields: { action: f.text() } });

  it("run in order and can add and change collections", async () => {
    const order: string[] = [];
    const first: Plugin = (config) => {
      order.push("first");
      return { ...config, admin: { title: "Mine" } };
    };
    const second = definePlugin({
      name: "audit",
      collections: [audit],
      extendCollections: (collections) => {
        order.push("second");
        return collections.map((c) =>
          c.slug === "users" ? extendCollection(c, { fields: { org: f.text() } }) : c,
        );
      },
      modules: [
        {
          key: "audit",
          label: "Audit",
          collections: ["audit"],
          nav: [{ label: "Log", collection: "audit" }],
        },
      ],
      onInit: async (qb) => {
        order.push("init");
        await qb.create("audit", { action: "boot" }, { user: null, overrideAccess: true });
      },
    });
    const config = defineConfig({
      db: testAdapter(),
      collections: [users],
      plugins: [first, second],
    });
    expect(order).toEqual(["first", "second"]);
    expect(config.plugins).toEqual(["audit"]);
    expect(config.admin.title).toBe("Mine");
    expect(config.collections.map((c) => c.slug)).toEqual(["users", "audit"]);
    expect(Object.keys(config.collections[0]!.fields)).toEqual(["name", "org"]);
    const qb = await createQuickben(config);
    expect(order).toEqual(["first", "second", "init"]);
    expect(await qb.count("audit", {}, { user: null, overrideAccess: true })).toBe(1);
  });

  it("cannot be applied twice", () => {
    const plugin = definePlugin({ name: "twice" });
    expect(() =>
      defineConfig({ db: testAdapter(), collections: [users], plugins: [plugin, plugin] }),
    ).toThrow(/applied twice/);
  });
});
