import { Readable } from "node:stream";

import { runStorageContractTests } from "@quickben/adapter-tests";
import { describe, expect, it, vi } from "vitest";

import { gcsStorage, normalizePrefix } from "../src";

import type { Bucket, Storage } from "@google-cloud/storage";

interface StoredObject {
  bytes: Buffer;
  contentType: string | undefined;
}

const notFound = () => Object.assign(new Error("No such object"), { code: 404 });

/** A bucket in memory with the methods of `@google-cloud/storage` the adapter uses. */
function fakeBucket(objects = new Map<string, StoredObject>()) {
  const signed: unknown[] = [];
  const bucket = {
    objects,
    signed,
    file(name: string) {
      return {
        save(bytes: Buffer, options: { contentType?: string }) {
          objects.set(name, { bytes: Buffer.from(bytes), contentType: options.contentType });
          return Promise.resolve();
        },
        getMetadata() {
          const object = objects.get(name);
          if (!object) return Promise.reject(notFound());
          return Promise.resolve([
            { size: String(object.bytes.length), contentType: object.contentType },
          ]);
        },
        createReadStream() {
          return Readable.from([objects.get(name)?.bytes ?? Buffer.alloc(0)]);
        },
        download() {
          const object = objects.get(name);
          return object ? Promise.resolve([object.bytes]) : Promise.reject(notFound());
        },
        delete() {
          objects.delete(name);
          return Promise.resolve();
        },
        getSignedUrl(options: unknown) {
          signed.push(options);
          return Promise.resolve([`https://storage.test/${name}`]);
        },
      };
    },
  };
  return bucket;
}

runStorageContractTests(() => gcsStorage({ bucket: fakeBucket() as unknown as Bucket }));

describe("gcsStorage", () => {
  it("uses a prefix", async () => {
    const bucket = fakeBucket();
    const storage = gcsStorage({ bucket: bucket as unknown as Bucket, prefix: "uploads" });
    await storage.put("a/b.png", new Uint8Array([1]));
    expect([...bucket.objects.keys()]).toEqual(["uploads/a/b.png"]);
    expect(normalizePrefix("x/y/")).toBe("x/y/");
    expect(normalizePrefix(undefined)).toBe("");
    expect(() => normalizePrefix("../x")).toThrow();
  });

  it("creates a bucket from a client once", async () => {
    const bucket = fakeBucket();
    const client = { bucket: vi.fn(() => bucket) };
    const storage = gcsStorage({ bucket: "files", storage: client as unknown as Storage });
    await storage.put("a.png", new Uint8Array([1]));
    await storage.head("a.png");
    expect(client.bucket).toHaveBeenCalledTimes(1);
    expect(client.bucket).toHaveBeenCalledWith("files");
  });

  it("creates a default client from the SDK", async () => {
    vi.resetModules();
    const bucket = fakeBucket();
    vi.doMock("@google-cloud/storage", () => ({
      Storage: class {
        bucket() {
          return bucket;
        }
      },
    }));
    const { gcsStorage: fresh } = await import("../src");
    const storage = fresh({ bucket: "files" });
    await storage.put("a.png", new Uint8Array([1]));
    expect(bucket.objects.has("a.png")).toBe(true);
    vi.doUnmock("@google-cloud/storage");
  });

  it("signs read URLs", async () => {
    const bucket = fakeBucket();
    const storage = gcsStorage({ bucket: bucket as unknown as Bucket });
    expect(await storage.signedUrl?.("a/b.pdf")).toBe("https://storage.test/a/b.pdf");
    await storage.signedUrl?.("a/b.pdf", { expiresIn: 60, downloadName: "Año.pdf" });
    expect(bucket.signed[0]).toMatchObject({ version: "v4", action: "read" });
    expect(bucket.signed[1]).toMatchObject({
      responseDisposition: "attachment; filename*=UTF-8''A%C3%B1o.pdf",
    });
  });

  it("rethrows errors other than not found", async () => {
    const bucket = {
      file: () => ({
        getMetadata: () => Promise.reject(Object.assign(new Error("denied"), { code: 403 })),
        download: () => Promise.reject(new Error("offline")),
      }),
    };
    const storage = gcsStorage({ bucket: bucket as unknown as Bucket });
    await expect(storage.head("a.png")).rejects.toThrow("denied");
    await expect(storage.getBytes("a.png")).rejects.toThrow("offline");
  });
});
