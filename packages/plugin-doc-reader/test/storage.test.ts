import {
  createQuickben,
  defineConfig,
  devAuth,
  memoryStorage,
  streamToBytes,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";

import { docReader, fromFileStore, memoryFileStore, readDocument } from "../src";
import { getDocReader } from "../src/options";

import { alice, as, PNG } from "./helpers";

describe("storage of readings", () => {
  it("uses the config storage when files is not given", async () => {
    const storage = memoryStorage();
    const config = defineConfig({
      db: memoryAdapter(),
      storage,
      auth: devAuth(),
      collections: [],
      plugins: [docReader({ log: () => undefined })],
    });
    const qb = await createQuickben(config);
    expect(getDocReader(qb).files).toBe(storage);
    await readDocument(
      qb,
      { type: "auto", file: { bytes: PNG, name: "a.png" }, wait: false },
      as(alice),
    ).catch(() => undefined);
    expect([...storage.objects.keys()].some((key) => key.startsWith("readings/"))).toBe(true);
  });

  it("keeps its own store when one is given", async () => {
    const own = memoryStorage();
    const config = defineConfig({
      db: memoryAdapter(),
      storage: memoryStorage(),
      collections: [],
      plugins: [docReader({ files: own, log: () => undefined })],
    });
    expect(getDocReader(await createQuickben(config)).files).toBe(own);
  });

  it("wraps a FileStore of earlier versions", async () => {
    const store = memoryFileStore();
    const storage = fromFileStore(store);
    await storage.put("a/b.png", PNG, { contentType: "image/png" });
    await storage.put("a/c", PNG);
    expect(store.files.get("a/b.png")).toEqual(PNG);
    expect(await storage.getBytes("a/b.png")).toEqual(PNG);
    expect(await storage.head("a/b.png")).toEqual({
      key: "a/b.png",
      size: PNG.byteLength,
      contentType: null,
    });
    const object = await storage.get("a/b.png");
    expect(object && (await streamToBytes(object.body))).toEqual(PNG);
    await storage.delete("a/b.png");
    expect(await storage.get("a/b.png")).toBeNull();
    expect(await storage.head("a/b.png")).toBeNull();
    // A store without delete.
    await expect(
      fromFileStore({ read: () => Promise.resolve(null), write: () => Promise.resolve() }).delete(
        "x",
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a FileStore in the options", async () => {
    const store = memoryFileStore();
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [docReader({ files: store, log: () => undefined })],
    });
    const qb = await createQuickben(config);
    await getDocReader(qb).files.put("x/y.png", PNG);
    expect(store.files.has("x/y.png")).toBe(true);
  });
});
