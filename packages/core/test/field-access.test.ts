import { describe, expect, it } from "vitest";

import {
  checkFieldAccess,
  createQuickben,
  defineCollection,
  defineConfig,
  fields as f,
  ForbiddenError,
  ValidationError,
} from "../src";

import { system, testAdapter } from "./helpers";

import type { QuickbenUser, RequestContext } from "../src";

const hr: QuickbenUser = { id: "hr", roles: ["hr"] };
const staff: QuickbenUser = { id: "staff" };
const as = (user: QuickbenUser | null): RequestContext => ({ user });
const isHr = ({ user }: { user: QuickbenUser | null }) => user?.roles?.includes("hr") ?? false;

const teams = defineCollection({
  slug: "teams",
  fields: {
    name: f.text({ required: true }),
    budget: f.number({ access: { read: isHr } }),
  },
  access: { read: () => true, create: () => true },
});

const employees = defineCollection({
  slug: "employees",
  fields: {
    name: f.text({ required: true }),
    salary: f.number({ access: { read: isHr, create: isHr, update: isHr } }),
    badge: f.text({ access: { update: () => false } }),
    level: f.number({ default: 1, access: { create: () => false } }),
    team: f.relation({ to: "teams" }),
    secretTeam: f.relation({ to: "teams", access: { read: () => false } }),
  },
  access: { read: () => true, create: () => true, update: () => true },
  hooks: {
    beforeChange: [
      ({ data, operation }) => (operation === "create" ? { ...data, badge: "auto" } : data),
    ],
  },
});

async function setup() {
  const qb = await createQuickben(
    defineConfig({ db: testAdapter(), collections: [teams, employees] }),
  );
  const team = await qb.create("teams", { name: "Core", budget: 10 }, system);
  const ada = await qb.create(
    "employees",
    { name: "Ada", salary: 200, team: team.id, secretTeam: team.id },
    system,
  );
  await qb.create("employees", { name: "Bob", salary: 100 }, system);
  return { qb, team, ada };
}

describe("field read access", () => {
  it("removes unreadable fields from documents", async () => {
    const { qb, ada } = await setup();
    const doc = await qb.findById("employees", ada.id, {}, as(staff));
    expect(doc).not.toHaveProperty("salary");
    expect(doc).not.toHaveProperty("secretTeam");
    expect(doc.name).toBe("Ada");
    const full = await qb.findById("employees", ada.id, {}, as(hr));
    expect(full.salary).toBe(200);
    const listed = await qb.find("employees", {}, as(staff));
    expect(listed.docs.every((item) => !("salary" in item))).toBe(true);
  });

  it("removes unreadable fields from select and from populated documents", async () => {
    const { qb, ada } = await setup();
    const doc = await qb.findById(
      "employees",
      ada.id,
      { select: ["name", "salary"], depth: 1 },
      as(staff),
    );
    expect(doc).toEqual({ id: ada.id, name: "Ada" });
    const deep = await qb.findById("employees", ada.id, { depth: 1 }, as(staff));
    expect(deep.team).toMatchObject({ name: "Core" });
    expect(deep.team).not.toHaveProperty("budget");
  });

  it("rejects unreadable fields in where and sort (#23)", async () => {
    const { qb } = await setup();
    await expect(
      qb.find("employees", { where: { salary: { gte: 150 } } }, as(staff)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      qb.find("employees", { where: { or: [{ salary: { gte: 150 } }] } }, as(staff)),
    ).rejects.toThrow('Unknown field "salary"');
    await expect(
      qb.count("employees", { where: { salary: { gt: 0 } } }, as(staff)),
    ).rejects.toThrow(ValidationError);
    await expect(qb.find("employees", { sort: "-salary" }, as(staff))).rejects.toThrow(
      'Cannot sort by "salary"',
    );
    const allowed = await qb.find(
      "employees",
      { where: { salary: { gte: 150 } }, sort: "-salary" },
      as(hr),
    );
    expect(allowed.docs.map((doc) => doc.name)).toEqual(["Ada"]);
  });

  it("strips fields from write results", async () => {
    const { qb, ada } = await setup();
    const updated = await qb.update("employees", ada.id, { name: "Ada L." }, as(staff));
    expect(updated).not.toHaveProperty("salary");
    expect(await qb.findById("employees", ada.id, {}, system)).toMatchObject({ salary: 200 });
  });
});

describe("field write access", () => {
  it("rejects create input that sets an unwritable field", async () => {
    const { qb } = await setup();
    const error: unknown = await qb
      .create("employees", { name: "Eve", salary: 1, level: 3 }, as(staff))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).fields).toEqual(["salary", "level"]);
    expect((error as ForbiddenError).message).toContain('"salary", "level"');
  });

  it("lets defaults and hooks set unwritable fields", async () => {
    const { qb } = await setup();
    const doc = await qb.create("employees", { name: "Eve" }, as(staff));
    const stored = await qb.findById("employees", doc.id, {}, system);
    expect(stored).toMatchObject({ level: 1, badge: "auto" });
  });

  it("rejects update input that sets an unwritable field", async () => {
    const { qb, ada } = await setup();
    await expect(qb.update("employees", ada.id, { badge: "x" }, as(hr))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(qb.update("employees", ada.id, { salary: 300 }, as(staff))).rejects.toThrow(
      '"salary"',
    );
    expect(await qb.update("employees", ada.id, { salary: 300 }, as(hr))).toMatchObject({
      salary: 300,
    });
    expect(
      await qb.update("employees", ada.id, { badge: undefined, name: "Ada" }, as(staff)),
    ).toMatchObject({ name: "Ada" });
  });

  it("skips field rules with overrideAccess", async () => {
    const { qb, ada } = await setup();
    expect(await qb.update("employees", ada.id, { badge: "x" }, system)).toMatchObject({
      badge: "x",
    });
  });
});

describe("checkFieldAccess", () => {
  it("lists denied fields per operation", async () => {
    const { qb } = await setup();
    const collection = qb.collections.employees;
    expect(
      [...(await checkFieldAccess(collection, "read", as(staff)))].sort((a, b) =>
        a.localeCompare(b),
      ),
    ).toEqual(["salary", "secretTeam"]);
    expect([...(await checkFieldAccess(collection, "read", as(hr)))]).toEqual(["secretTeam"]);
    expect([...(await checkFieldAccess(collection, "update", as(hr)))]).toEqual(["badge"]);
    expect((await checkFieldAccess(collection, "create", system)).size).toBe(0);
  });

  it("passes the operation, id and data to rules", async () => {
    const seen: unknown[] = [];
    const audited = defineCollection({
      slug: "audited",
      fields: {
        note: f.text({
          access: {
            update: (args) => {
              seen.push({ operation: args.operation, id: args.id, data: args.data });
              return Promise.resolve(true);
            },
          },
        }),
      },
      access: { read: () => true, create: () => true, update: () => true },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [audited] }));
    const doc = await qb.create("audited", { note: "a" }, as(staff));
    await qb.update("audited", doc.id, { note: "b" }, as(staff));
    expect(seen).toEqual([{ operation: "update", id: doc.id, data: { note: "b" } }]);
  });
});
