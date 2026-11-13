import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { inProcessRunner, localFileStore, memoryFileStore } from "../src";
import { assertSafeRef } from "../src/files";

describe("inProcessRunner", () => {
  it("runs queued jobs with limited concurrency, also those queued before start", async () => {
    const runner = inProcessRunner({ concurrency: 2 });
    let running = 0;
    let peak = 0;
    const seen: string[] = [];
    await runner.enqueue("early", 1);
    runner.start(async (jobId) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(jobId);
      running -= 1;
      if (jobId === "boom") throw new Error("boom");
    });
    for (const id of ["a", "b", "boom", "c"]) await runner.enqueue(id, 1);
    await runner.enqueue("dropped", 1);
    await runner.remove?.("dropped", 1);
    await runner.remove?.("never", 1);
    await runner.idle();
    expect(seen.toSorted((a, b) => a.localeCompare(b))).toEqual(["a", "b", "boom", "c", "early"]);
    expect(peak).toBe(2);
  });

  it("defers work, e.g. to Next.js after()", async () => {
    const deferred: (() => Promise<void>)[] = [];
    const runner = inProcessRunner({ defer: (task) => deferred.push(task) });
    const processor = vi.fn(() => Promise.resolve());
    runner.start(processor);
    await runner.enqueue("a", 1);
    const task = vi.fn(() => Promise.resolve());
    runner.background(task);
    expect(processor).not.toHaveBeenCalled();
    await Promise.all(deferred.map((run) => run()));
    expect(processor).toHaveBeenCalledWith("a", 1);
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("file stores", () => {
  it("keeps files in memory", async () => {
    const store = memoryFileStore();
    await store.write("a/b.pdf", new Uint8Array([1, 2]), "application/pdf");
    expect(await store.read("a/b.pdf")).toEqual(new Uint8Array([1, 2]));
    await store.delete?.("a/b.pdf");
    expect(await store.read("a/b.pdf")).toBeNull();
  });

  it("keeps files in a directory and refuses refs that escape it", async () => {
    const root = await mkdtemp(join(tmpdir(), "qb-doc-reader-"));
    try {
      const store = localFileStore(root);
      await store.write("x/y.png", new Uint8Array([3]), "image/png");
      expect(await store.read("x/y.png")).toEqual(new Uint8Array([3]));
      await store.delete?.("x/y.png");
      expect(await store.read("x/y.png")).toBeNull();
      await expect(store.read("../etc/passwd")).rejects.toThrow(TypeError);
      await expect(localFileStore(join(root, "file")).read("x")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    for (const bad of ["", "/abs", "a/../../b", "..", "a\\b"])
      expect(() => assertSafeRef(bad)).toThrow(TypeError);
  });
});
