import { describe, expect, it } from "vitest";

import {
  chainAuth,
  ConfigError,
  createQuickben,
  customAuth,
  defineCollection,
  defineConfig,
  fields as f,
  pluginState,
  UnauthorizedError,
  ValidationError,
} from "../src";

import { system, testAdapter } from "./helpers";

import type { AuthAdapter, QuickbenConfig, RequestContext } from "../src";

const req = new Request("http://localhost/");
const fixed = (id: string | null): AuthAdapter => ({
  getUser: () => Promise.resolve(id === null ? null : { id }),
});

describe("customAuth", () => {
  it("wraps a function and turns undefined into null", async () => {
    await expect(customAuth({ getUser: () => ({ id: "u1" }) }).getUser(req)).resolves.toEqual({
      id: "u1",
    });
    await expect(customAuth({ getUser: () => undefined }).getUser(req)).resolves.toBeNull();
  });
});

describe("chainAuth", () => {
  it("returns the first user found", async () => {
    await expect(chainAuth(fixed(null), fixed("a"), fixed("b")).getUser(req)).resolves.toEqual({
      id: "a",
    });
  });

  it("returns null when no adapter finds a user", async () => {
    await expect(chainAuth(fixed(null), fixed(null)).getUser(req)).resolves.toBeNull();
  });

  it("treats UnauthorizedError as no user and throws other errors", async () => {
    const unauthorized: AuthAdapter = {
      getUser: () => Promise.reject(new UnauthorizedError("expired")),
    };
    const broken: AuthAdapter = { getUser: () => Promise.reject(new Error("db down")) };
    await expect(chainAuth(unauthorized, fixed("b")).getUser(req)).resolves.toEqual({ id: "b" });
    await expect(chainAuth(broken, fixed("b")).getUser(req)).rejects.toThrow("db down");
  });

  it("needs at least one adapter", () => {
    expect(() => chainAuth()).toThrow(ConfigError);
  });
});

const notes = defineCollection({
  slug: "notes",
  fields: { text: f.text({ required: true }) },
  access: { read: () => true, create: () => true, update: () => true },
  trackAuthor: true,
});

async function setup() {
  return createQuickben(defineConfig({ db: testAdapter(), collections: [notes] }));
}

describe("preserveTimestamps", () => {
  const importing: RequestContext = { ...system, preserveTimestamps: true };

  it("keeps createdAt and updatedAt on create", async () => {
    const qb = await setup();
    const doc = await qb.create(
      "notes",
      {
        text: "old",
        createdAt: "2020-01-02T03:04:05.000Z",
        updatedAt: new Date("2021-01-01T00:00:00Z"),
      },
      importing,
    );
    expect(doc.createdAt).toBe("2020-01-02T03:04:05.000Z");
    expect(doc.updatedAt).toBe("2021-01-01T00:00:00.000Z");
  });

  it("uses createdAt for updatedAt when only createdAt is given", async () => {
    const qb = await setup();
    const doc = await qb.create(
      "notes",
      { text: "a", createdAt: "2020-05-01T10:00:00" },
      importing,
    );
    expect(doc.createdAt).toBe("2020-05-01T10:00:00.000Z");
    expect(doc.updatedAt).toBe(doc.createdAt);
    const fresh = await qb.create("notes", { text: "b" }, importing);
    expect(fresh.createdAt).toBe(fresh.updatedAt);
    expect(fresh.createdAt > "2025").toBe(true);
  });

  it("keeps timestamps on update", async () => {
    const qb = await setup();
    const doc = await qb.create("notes", { text: "a" }, system);
    const updated = await qb.update(
      "notes",
      doc.id,
      { text: "b", createdAt: "2019-01-01T00:00:00Z", updatedAt: "2019-06-01T00:00:00Z" },
      importing,
    );
    expect(updated.createdAt).toBe("2019-01-01T00:00:00.000Z");
    expect(updated.updatedAt).toBe("2019-06-01T00:00:00.000Z");
  });

  it("rejects invalid values", async () => {
    const qb = await setup();
    await expect(
      qb.create("notes", { text: "a", createdAt: "yesterday" }, importing),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      qb.create("notes", { text: "a", createdAt: 5 } as never, importing),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects timestamps without the option or without overrideAccess", async () => {
    const qb = await setup();
    const input = { text: "a", createdAt: "2020-01-01T00:00:00Z" };
    await expect(qb.create("notes", input, system)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      qb.create("notes", input, { user: { id: "u1" }, preserveTimestamps: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("trackAuthor", () => {
  it("adds read-only createdBy and updatedBy fields", () => {
    expect(Object.keys(notes.fields)).toEqual(["text", "createdBy", "updatedBy"]);
    expect(notes.fields.createdBy.admin.readOnly).toBe(true);
  });

  it("fills them from the user", async () => {
    const qb = await setup();
    const doc = await qb.create("notes", { text: "a" }, { user: { id: "u1" } });
    expect(doc).toMatchObject({ createdBy: "u1", updatedBy: "u1" });
    const updated = await qb.update("notes", doc.id, { text: "b" }, { user: { id: "u2" } });
    expect(updated).toMatchObject({ createdBy: "u1", updatedBy: "u2" });
    const bySystem = await qb.update("notes", doc.id, { text: "c" }, system);
    expect(bySystem.updatedBy).toBe("u2");
    const anonymous = await qb.create("notes", { text: "d" }, system);
    expect(anonymous).toMatchObject({ createdBy: null, updatedBy: null });
  });

  it("refuses author values from users and keeps them from trusted code", async () => {
    const qb = await setup();
    await expect(
      qb.create("notes", { text: "a", createdBy: "x" }, { user: { id: "u1" } }),
    ).rejects.toThrow(/createdBy/);
    const imported = await qb.create(
      "notes",
      { text: "a", createdBy: "legacy", updatedBy: "legacy2" },
      system,
    );
    expect(imported).toMatchObject({ createdBy: "legacy", updatedBy: "legacy2" });
  });

  it("runs before the collection's own beforeChange hooks", async () => {
    const seen: unknown[] = [];
    const tracked = defineCollection({
      slug: "tracked",
      fields: { text: f.text() },
      access: { create: () => true },
      hooks: {
        beforeChange: [
          ({ data }) => {
            seen.push((data as Record<string, unknown>).createdBy);
          },
        ],
      },
      trackAuthor: true,
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [tracked] }));
    await qb.create("tracked", { text: "a" }, { user: { id: "u9" } });
    expect(seen).toEqual(["u9"]);
  });

  it("rejects a collection that already has the fields", () => {
    expect(() =>
      defineCollection({ slug: "x", fields: { createdBy: f.text() }, trackAuthor: true }),
    ).toThrow(ConfigError);
  });
});

describe("pluginState", () => {
  it("survives a module reload", () => {
    const config = {} as QuickbenConfig;
    pluginState<string>("test-plugin").set(config, "value");
    // A reloaded module calls pluginState again and gets the same store.
    expect(pluginState<string>("test-plugin").get(config)).toBe("value");
    expect(pluginState<string>("other-plugin").get(config)).toBeUndefined();
  });
});
