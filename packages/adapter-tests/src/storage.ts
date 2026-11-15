import { streamToBytes } from "@quickben/core";
import { describe, expect, it } from "vitest";

import type { StorageAdapter } from "@quickben/core";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/**
 * The shared suite every storage adapter runs:
 *
 * ```ts
 * runStorageContractTests(() => fooStorage());
 * ```
 *
 * `createStorage` is called once per test and should return an empty store.
 */
export function runStorageContractTests(
  createStorage: () => StorageAdapter | Promise<StorageAdapter>,
): void {
  describe("storage adapter contract", () => {
    it("puts and reads an object as bytes and as a stream", async () => {
      const storage = await createStorage();
      await storage.put("docs/logo/a.png", png, { contentType: "image/png" });
      expect(await storage.getBytes("docs/logo/a.png")).toEqual(png);
      const object = await storage.get("docs/logo/a.png");
      expect(object).toMatchObject({ key: "docs/logo/a.png", size: png.byteLength });
      expect(object && (await streamToBytes(object.body))).toEqual(png);
    });

    it("heads an object", async () => {
      const storage = await createStorage();
      await storage.put("docs/logo/a.png", png, { contentType: "image/png" });
      expect(await storage.head("docs/logo/a.png")).toEqual({
        key: "docs/logo/a.png",
        size: png.byteLength,
        contentType: "image/png",
      });
    });

    it("replaces an object with the same key", async () => {
      const storage = await createStorage();
      await storage.put("a/b.png", png);
      await storage.put("a/b.png", png.subarray(0, 8));
      expect(await storage.getBytes("a/b.png")).toEqual(png.subarray(0, 8));
    });

    it("returns null for missing objects", async () => {
      const storage = await createStorage();
      expect(await storage.get("missing/a.png")).toBeNull();
      expect(await storage.getBytes("missing/a.png")).toBeNull();
      expect(await storage.head("missing/a.png")).toBeNull();
    });

    it("deletes objects, and missing ones without an error", async () => {
      const storage = await createStorage();
      await storage.put("a/b.png", png);
      await storage.delete("a/b.png");
      await storage.delete("a/b.png");
      expect(await storage.head("a/b.png")).toBeNull();
    });

    it.each(["/etc/passwd", "../outside.png", "a/../../b", "a\\b", ""])(
      "rejects the key %j",
      async (key) => {
        const storage = await createStorage();
        await expect(storage.put(key, png)).rejects.toThrow();
        await expect(storage.get(key)).rejects.toThrow();
        await expect(storage.getBytes(key)).rejects.toThrow();
        await expect(storage.head(key)).rejects.toThrow();
        await expect(storage.delete(key)).rejects.toThrow();
      },
    );
  });
}
