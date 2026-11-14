import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStorageContractTests } from "@quickben/adapter-tests";
import { afterAll, describe, expect, it } from "vitest";

import { localFileStorage } from "../src";

const roots: string[] = [];

async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), "qb-storage-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

runStorageContractTests(async () => localFileStorage({ root: await freshRoot() }));

describe("localFileStorage", () => {
  it("writes files under the root without temporary leftovers", async () => {
    const root = await freshRoot();
    const storage = localFileStorage({ root });
    await storage.put("a/b/c.pdf", new TextEncoder().encode("%PDF-1"));
    expect(await readdir(join(root, "a/b"))).toEqual(["c.pdf"]);
    expect(await storage.head("a/b/c.pdf")).toMatchObject({ contentType: "application/pdf" });
  });

  it("has no type for unknown extensions", async () => {
    const storage = localFileStorage({ root: await freshRoot() });
    await storage.put("a/b", new Uint8Array([1]));
    await storage.put("a/c.xyz", new Uint8Array([1]));
    expect((await storage.head("a/b"))?.contentType).toBeNull();
    expect((await storage.head("a/c.xyz"))?.contentType).toBeNull();
  });

  it("treats directories and paths through files as missing", async () => {
    const root = await freshRoot();
    const storage = localFileStorage({ root });
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "file"), "x");
    expect(await storage.head("dir")).toBeNull();
    expect(await storage.getBytes("dir")).toBeNull();
    expect(await storage.head("file/inside")).toBeNull();
    expect(await storage.getBytes("file/inside")).toBeNull();
  });

  it("removes the temporary file when a write fails", async () => {
    const root = await freshRoot();
    const storage = localFileStorage({ root });
    await mkdir(join(root, "a/b.png"), { recursive: true });
    await expect(storage.put("a/b.png", new Uint8Array([1]))).rejects.toThrow();
    expect(await readdir(join(root, "a"))).toEqual(["b.png"]);
  });

  it("rethrows other errors", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "file"), "x");
    // The root is a file: every path below it fails with ENOTDIR, a write with another error.
    const storage = localFileStorage({ root: join(root, "file") });
    await expect(storage.put("a.png", new Uint8Array([1]))).rejects.toThrow();
  });
});
