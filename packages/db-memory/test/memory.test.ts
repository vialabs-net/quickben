import { ConflictError } from "@quickben/core";
import { beforeEach, describe, expect, it } from "vitest";

import { memoryAdapter } from "../src";

import type { MemoryStore } from "../src";
import type { DatabaseAdapter, DatabaseSchema } from "@quickben/core";

const schema: DatabaseSchema = {
  collections: [
    {
      slug: "users",
      fields: [
        { name: "email", type: "email", many: false, required: false, unique: true, index: false },
      ],
    },
  ],
};

const user = (id: string, email: string | null) => ({ id, email, createdAt: "", updatedAt: "" });

describe("memoryAdapter", () => {
  let db: DatabaseAdapter<MemoryStore>;

  beforeEach(async () => {
    db = memoryAdapter({ initialData: { users: [user("u0", "zero@example.com")] } });
    await db.init(schema);
  });

  it("loads initial data and keeps it on init", async () => {
    await db.init(schema);
    expect(await db.count({ collection: "users" })).toBe(1);
    expect(db.raw.collections.get("users")?.get("u0")).toMatchObject({ email: "zero@example.com" });
  });

  it("returns copies, not stored objects", async () => {
    const found = await db.findOne({ collection: "users" });
    if (found) found.email = "changed";
    expect((await db.findOne({ collection: "users" }))?.email).toBe("zero@example.com");
  });

  it("isolates transactions until commit", async () => {
    let inside = 0;
    await db.transaction(async (tx) => {
      await tx.create({ collection: "users", data: user("u1", "one@example.com") });
      inside = await tx.count({ collection: "users" });
      expect(await db.count({ collection: "users" })).toBe(1);
      expect(tx.raw.collections.get("users")?.size).toBe(2);
    });
    expect(inside).toBe(2);
    expect(await db.count({ collection: "users" })).toBe(2);
  });

  it("keeps writes made outside a running transaction", async () => {
    await db.transaction(async (tx) => {
      await tx.update({ collection: "users", id: "u0", data: { email: "new@example.com" } });
      await db.create({ collection: "users", data: user("u2", "two@example.com") });
    });
    expect(await db.count({ collection: "users" })).toBe(2);
    expect(
      (await db.findOne({ collection: "users", where: { field: "id", op: "eq", value: "u0" } }))
        ?.email,
    ).toBe("new@example.com");
  });

  it("checks unique values again on commit", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.create({ collection: "users", data: user("u3", "dup@example.com") });
        await db.create({ collection: "users", data: user("u4", "dup@example.com") });
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await db.count({ collection: "users" })).toBe(2);
  });

  it("detects ids taken by a concurrent commit", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.create({ collection: "users", data: user("u5", null) });
        await db.create({ collection: "users", data: user("u5", null) });
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", field: "id" });
  });

  it("can delete and create the same id in one transaction", async () => {
    await db.transaction(async (tx) => {
      await tx.delete({ collection: "users", id: "u0" });
      await tx.create({ collection: "users", data: user("u0", "again@example.com") });
    });
    expect((await db.findOne({ collection: "users" }))?.email).toBe("again@example.com");
  });

  it("works on collections it was not told about", async () => {
    await db.create({ collection: "other", data: { id: "x", createdAt: "", updatedAt: "" } });
    expect(await db.find({ collection: "other", limit: 5, offset: 0 })).toHaveLength(1);
    expect(await db.find({ collection: "missing" })).toEqual([]);
    await db.close?.();
  });
});
