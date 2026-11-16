import { describe, expect, it, vi } from "vitest";

import { createQuickben, defineCollection, defineConfig, fields as f } from "../src";

import { system, testAdapter } from "./helpers";

import type { AfterCommitHook, DocumentData, Quickben } from "../src";

interface Event {
  operation: string;
  id: unknown;
  original: unknown;
  inTransaction: boolean;
}

function setup(extra: AfterCommitHook[] = []) {
  const events: Event[] = [];
  const db = testAdapter();
  let root: Quickben | undefined;
  const record: AfterCommitHook = ({ operation, doc, original, qb }) => {
    events.push({
      operation,
      id: doc.id,
      original: original?.id ?? null,
      inTransaction: qb !== root,
    });
  };
  const notes = defineCollection({
    slug: "notes",
    fields: { text: f.text({ required: true }) },
    access: { read: () => true, create: () => true, update: () => true, delete: () => true },
    hooks: { afterCommit: [record, ...extra] },
  });
  const logs = defineCollection({
    slug: "logs",
    fields: { message: f.text({ required: true }) },
    access: { read: () => true, create: () => true },
  });
  return createQuickben(defineConfig({ db, collections: [notes, logs] })).then((qb) => {
    root = qb;
    return { qb, events };
  });
}

describe("afterCommit hooks", () => {
  it("run after create, update and delete with the root local API", async () => {
    const { qb, events } = await setup();
    const note = await qb.create("notes", { text: "a" }, system);
    expect(events).toEqual([
      { operation: "create", id: note.id, original: null, inTransaction: false },
    ]);
    await qb.update("notes", note.id, { text: "b" }, system);
    await qb.delete("notes", note.id, system);
    expect(events.map((event) => [event.operation, event.original])).toEqual([
      ["create", null],
      ["update", note.id],
      ["delete", note.id],
    ]);
  });

  it("wait for the outermost transaction and keep their order", async () => {
    const { qb, events } = await setup();
    await qb.transaction(async (tx) => {
      await tx.create("notes", { text: "a" }, system);
      await tx.transaction(async (inner) => {
        await inner.create("notes", { text: "b" }, system);
      });
      expect(events).toEqual([]);
    });
    expect(events.map((event) => event.operation)).toEqual(["create", "create"]);
  });

  it("are dropped when the transaction rolls back", async () => {
    const { qb, events } = await setup();
    await expect(
      qb.transaction(async (tx) => {
        await tx.create("notes", { text: "a" }, system);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(events).toEqual([]);
    expect(await qb.count("notes", {}, system)).toBe(0);
  });

  it("wait for committed() when writes join a host transaction", async () => {
    const { qb, events } = await setup();
    let scope: ReturnType<Quickben["withTransaction"]> | undefined;
    await qb.db.transaction(async (tx) => {
      scope = qb.withTransaction(tx);
      await scope.qb.create("notes", { text: "a" }, system);
      await scope.qb.transaction((inner) => inner.create("notes", { text: "b" }, system));
      expect(await scope.qb.count("notes", {}, system)).toBe(2);
    });
    expect(events).toEqual([]);
    await scope?.committed();
    expect(events.map((event) => [event.operation, event.inTransaction])).toEqual([
      ["create", false],
      ["create", false],
    ]);
    await scope?.committed();
    await scope?.rolledBack();
    expect(events).toHaveLength(2);
  });

  it("are dropped when the host transaction rolls back", async () => {
    const { qb, events } = await setup();
    let scope: ReturnType<Quickben["withTransaction"]> | undefined;
    await expect(
      qb.db.transaction(async (tx) => {
        scope = qb.withTransaction(tx);
        await scope.qb.create("notes", { text: "a" }, system);
        throw new Error("host failed");
      }),
    ).rejects.toThrow("host failed");
    await scope?.rolledBack();
    await scope?.committed();
    expect(events).toEqual([]);
    expect(await qb.count("notes", {}, system)).toBe(0);
  });

  it("log errors without undoing the write", async () => {
    const failing: AfterCommitHook = () => {
      throw new Error("queue down");
    };
    const { qb, events } = await setup([failing]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const note = await qb.create("notes", { text: "a" }, system);
    expect(log).toHaveBeenCalledWith("[quickben] afterCommit hook failed", expect.any(Error));
    log.mockRestore();
    expect(events).toHaveLength(1);
    expect(await qb.findById("notes", note.id, {}, system)).toMatchObject({ text: "a" });
  });

  it("can write with the root local API", async () => {
    const write: AfterCommitHook = async ({ qb, doc, ctx }) => {
      await qb.create("logs", { message: `saved ${String((doc as DocumentData).text)}` }, ctx);
    };
    const { qb } = await setup([write]);
    await qb.create("notes", { text: "a" }, system);
    const logs = await qb.find("logs", {}, system);
    expect(logs.docs.map((doc) => doc.message)).toEqual(["saved a"]);
  });
});
