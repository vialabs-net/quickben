import { describe, expect, it, vi } from "vitest";

import {
  assertStorageKey,
  bytesToStream,
  cleanFileName,
  ConfigError,
  createQuickben,
  defineCollection,
  defineConfig,
  detectMime,
  fields as f,
  isFileRef,
  memoryStorage,
  mimeMatches,
  NotFoundError,
  sha256Hex,
  sniffMime,
  streamToBytes,
  ValidationError,
} from "../src";

import { system, testAdapter } from "./helpers";

import type { FileRef, MemoryStorage, RequestContext, StorageAdapter } from "../src";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdf = new TextEncoder().encode("%PDF-1.7 test");
const user: RequestContext = { user: { id: "u1" } };

function setup(options: { storage?: StorageAdapter; fieldStorage?: StorageAdapter } = {}) {
  const storage = options.storage ?? memoryStorage();
  const docs = defineCollection({
    slug: "docs",
    fields: {
      title: f.text(),
      logo: f.file({
        accept: ["image/*"],
        maxBytes: 64,
        ...(options.fieldStorage ? { storage: options.fieldStorage } : {}),
      }),
      attachment: f.file({ validate: (ref) => (ref.name === "bad.pdf" ? "Bad name" : true) }),
      secret: f.file({ access: { read: () => false } }),
    },
    access: {
      read: ({ user }) => (user ? { title: { ne: "hidden" } } : false),
      create: () => true,
      update: () => true,
      delete: () => true,
    },
  });
  const config = defineConfig({ db: testAdapter(), storage, collections: [docs] });
  return createQuickben(config).then((qb) => ({ qb, storage: storage as MemoryStorage }));
}

describe("storage keys", () => {
  it("accepts relative paths", () => {
    expect(assertStorageKey("a/b/c.png")).toBe("a/b/c.png");
  });

  it.each(["", "/abs", "C:/x", "a\\b", "a/../b", "..", "a//b", "./a", "a/\u0000"])(
    "rejects %j",
    (key) => {
      expect(() => assertStorageKey(key)).toThrow(ValidationError);
    },
  );

  it("rejects long keys", () => {
    expect(() => assertStorageKey("a".repeat(1025))).toThrow(/too long/);
  });
});

describe("file types", () => {
  it("sniffs by the first bytes", () => {
    const ascii = (text: string) => new TextEncoder().encode(text);
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(sniffMime(ascii("GIF89a"))).toBe("image/gif");
    expect(sniffMime(ascii("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(ascii("0000ftypavif"))).toBe("image/avif");
    expect(sniffMime(ascii("wOF2"))).toBe("font/woff2");
    expect(sniffMime(ascii("wOFF"))).toBe("font/woff");
    expect(sniffMime(ascii("<svg>"))).toBeNull();
  });

  it("detects text and binary", () => {
    expect(detectMime(new TextEncoder().encode("a,b\n1,2\n"))).toBe("text/plain");
    expect(detectMime(new Uint8Array([0, 1, 2]))).toBe("application/octet-stream");
    expect(detectMime(new Uint8Array([0xc3, 0x28]))).toBe("application/octet-stream");
    expect(detectMime(new Uint8Array())).toBe("application/octet-stream");
  });

  it("matches accept patterns", () => {
    expect(mimeMatches("image/png", ["image/*"])).toBe(true);
    expect(mimeMatches("image/png", ["application/pdf", "image/png"])).toBe(true);
    expect(mimeMatches("application/pdf", ["image/*"])).toBe(false);
  });

  it("hashes and streams bytes", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await streamToBytes(bytesToStream(png))).toEqual(png);
  });

  it("cleans file names", () => {
    expect(cleanFileName("C:\\Users\\me\\logo.png")).toBe("logo.png");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b.txt")).toBe("ab.txt");
    expect(cleanFileName("  ")).toBe("file");
  });
});

describe("memoryStorage", () => {
  it("puts, reads, heads and deletes", async () => {
    const storage = memoryStorage();
    await storage.put("a/b.png", png, { contentType: "image/png" });
    expect(await storage.head("a/b.png")).toEqual({
      key: "a/b.png",
      size: png.byteLength,
      contentType: "image/png",
    });
    expect(await storage.getBytes("a/b.png")).toEqual(png);
    const object = await storage.get("a/b.png");
    expect(object && (await streamToBytes(object.body))).toEqual(png);
    await storage.put("a/c", png);
    expect((await storage.head("a/c"))?.contentType).toBeNull();
    await storage.delete("a/b.png");
    await storage.delete("a/missing");
    expect(await storage.get("a/b.png")).toBeNull();
    expect(await storage.getBytes("a/b.png")).toBeNull();
    expect(await storage.head("a/b.png")).toBeNull();
    await expect(storage.put("../x", png)).rejects.toThrow(ValidationError);
  });
});

describe("file fields", () => {
  it("rejects bad options", () => {
    const make = (field: ReturnType<typeof f.file>) =>
      defineConfig({
        db: testAdapter(),
        collections: [defineCollection({ slug: "x", fields: { file: field } })],
      });
    expect(() => make(f.file({ maxBytes: 0 }))).toThrow(ConfigError);
    expect(() => make(f.file({ accept: ["png"] }))).toThrow(ConfigError);
    expect(make(f.file({ accept: ["image/*", "application/pdf"] })).storage).toBeUndefined();
  });

  it("stores an upload and keeps a reference", async () => {
    const { qb, storage } = await setup();
    const doc = await qb.create(
      "docs",
      { title: "a", logo: new File([png], "dir/logo.png", { type: "text/html" }) },
      user,
    );
    const logo = doc.logo!;
    expect(logo).toMatchObject({ name: "logo.png", mime: "image/png", size: png.byteLength });
    expect(logo.key).toMatch(/^docs\/logo\/[\da-f-]{36}\.png$/);
    expect(logo.sha256).toBe(await sha256Hex(png));
    expect(isFileRef(logo)).toBe(true);
    expect(await storage.getBytes(logo.key)).toEqual(png);
    expect(await storage.head(logo.key)).toMatchObject({ contentType: "image/png" });

    const file = await qb.readFile("docs", doc.id, "logo", user);
    expect(file.file).toEqual(logo);
    expect(file.size).toBe(png.byteLength);
    expect(await streamToBytes(file.body)).toEqual(png);
  });

  it("accepts bytes with a name", async () => {
    const { qb } = await setup();
    const doc = await qb.create(
      "docs",
      { attachment: { name: "a.pdf", bytes: pdf, type: "application/pdf" } },
      user,
    );
    expect(doc.attachment).toMatchObject({ name: "a.pdf", mime: "application/pdf" });
    const blob = await qb.create("docs", { attachment: new Blob([pdf]) }, user);
    expect(blob.attachment).toMatchObject({ name: "file", mime: "application/pdf" });
  });

  it("checks type, size, emptiness and validate", async () => {
    const { qb, storage } = await setup();
    const fail = (data: Record<string, unknown>) =>
      qb.create("docs", data as never, user).catch((error: unknown) => error);
    const typeError = await fail({ logo: { name: "x.pdf", bytes: pdf } });
    expect(typeError).toBeInstanceOf(ValidationError);
    expect((typeError as ValidationError).issues[0]).toMatchObject({ path: "logo" });
    expect((typeError as ValidationError).issues[0]?.message).toMatch(/application\/pdf/);
    const big = new Uint8Array(65);
    big.set(png);
    expect(await fail({ logo: { name: "x.png", bytes: big } })).toMatchObject({
      issues: [{ path: "logo", message: "The file is larger than 1 KB" }],
    });
    expect(await fail({ logo: new File([big], "x.png") })).toBeInstanceOf(ValidationError);
    expect(await fail({ attachment: { name: "x", bytes: new Uint8Array() } })).toMatchObject({
      issues: [{ message: "The file is empty" }],
    });
    expect(await fail({ attachment: { name: "bad.pdf", bytes: pdf } })).toMatchObject({
      issues: [{ message: "Bad name" }],
    });
    expect(await fail({ attachment: "data:x" })).toBeInstanceOf(ValidationError);
    // Nothing was stored for invalid input.
    expect(storage.objects.size).toBe(0);
  });

  it("refuses references that are not the stored one", async () => {
    const { qb } = await setup();
    const forged: FileRef = {
      key: "other/tenant/file.pdf",
      name: "x.pdf",
      mime: "application/pdf",
      size: 1,
      sha256: "0".repeat(64),
    };
    await expect(qb.create("docs", { attachment: forged }, user)).rejects.toMatchObject({
      issues: [{ path: "attachment" }],
    });
    // Trusted code may set references.
    const doc = await qb.create("docs", { attachment: forged }, system);
    expect(doc.attachment).toEqual(forged);
    // The stored reference can be sent back.
    const same = await qb.update("docs", doc.id, { attachment: forged, title: "b" }, user);
    expect(same.attachment).toEqual(forged);
  });

  it("removes the old file after a replace, a clear and a delete", async () => {
    const { qb, storage } = await setup();
    const doc = await qb.create("docs", { logo: { name: "a.png", bytes: png } }, user);
    const first = doc.logo!.key;
    const replaced = await qb.update("docs", doc.id, { logo: { name: "b.png", bytes: png } }, user);
    const second = replaced.logo!.key;
    expect(second).not.toBe(first);
    expect(storage.objects.has(first)).toBe(false);
    expect(storage.objects.has(second)).toBe(true);

    await qb.update("docs", doc.id, { title: "kept" }, user);
    expect(storage.objects.has(second)).toBe(true);
    await qb.update("docs", doc.id, { logo: null }, user);
    expect(storage.objects.has(second)).toBe(false);

    const other = await qb.create(
      "docs",
      { logo: { name: "c.png", bytes: png }, attachment: { name: "d.pdf", bytes: pdf } },
      user,
    );
    expect(storage.objects.size).toBe(2);
    await qb.delete("docs", other.id, user);
    expect(storage.objects.size).toBe(0);
  });

  it("removes stored files when the write fails", async () => {
    const { qb, storage } = await setup();
    await expect(
      qb.transaction(async (tx) => {
        await tx.create("docs", { logo: { name: "a.png", bytes: png } }, user);
        expect(storage.objects.size).toBe(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(storage.objects.size).toBe(0);

    // A failing write inside a transaction that goes on removes its own files at once.
    await qb.transaction(async (tx) => {
      await expect(
        tx.create("docs", { title: "hidden", logo: { name: "a.png", bytes: png } }, user),
      ).resolves.toBeDefined();
      await expect(
        tx.update("docs", "missing", { logo: { name: "b.png", bytes: png } }, user),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
    expect(storage.objects.size).toBe(1);
  });

  it("logs a failing cleanup and goes on", async () => {
    const storage = memoryStorage();
    const failing: StorageAdapter = {
      ...storage,
      delete: () => Promise.reject(new Error("offline")),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { qb } = await setup({ storage: failing });
    const doc = await qb.create("docs", { attachment: { name: "a.pdf", bytes: pdf } }, user);
    await expect(qb.delete("docs", doc.id, user)).resolves.toBeDefined();
    await expect(
      qb.transaction(async (tx) => {
        await tx.create("docs", { attachment: { name: "a.pdf", bytes: pdf } }, user);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("uses the field's own storage", async () => {
    const own = memoryStorage();
    const { qb, storage } = await setup({ fieldStorage: own });
    await qb.create("docs", { logo: { name: "a.png", bytes: png } }, user);
    expect(own.objects.size).toBe(1);
    expect(storage.objects.size).toBe(0);
  });

  it("needs a storage adapter for uploads", async () => {
    const docs = defineCollection({
      slug: "docs",
      fields: { file: f.file() },
      access: { create: () => true },
    });
    const qb = await createQuickben(defineConfig({ db: testAdapter(), collections: [docs] }));
    await expect(
      qb.create("docs", { file: { name: "a.pdf", bytes: pdf } }, user),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(qb.create("docs", { file: null }, user)).resolves.toMatchObject({ file: null });
  });

  it("reads files with the document's read access", async () => {
    const { qb, storage } = await setup();
    const doc = await qb.create(
      "docs",
      {
        title: "hidden",
        logo: { name: "a.png", bytes: png },
        secret: { name: "s.pdf", bytes: pdf },
      },
      user,
    );
    await expect(qb.readFile("docs", doc.id, "logo", user)).rejects.toBeInstanceOf(NotFoundError);
    await qb.update("docs", doc.id, { title: "shown" }, system);
    await expect(qb.readFile("docs", doc.id, "logo", user)).resolves.toBeDefined();
    // An unreadable field.
    await expect(qb.readFile("docs", doc.id, "secret", user)).rejects.toBeInstanceOf(NotFoundError);
    // No file, a missing object, not a file field, no user.
    await expect(qb.readFile("docs", doc.id, "attachment", user)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    storage.objects.clear();
    await expect(qb.readFile("docs", doc.id, "logo", user)).rejects.toThrow(/missing/);
    await expect(qb.readFile("docs", doc.id, "title" as never, user)).rejects.toThrow(
      /not a file field/,
    );
    await expect(qb.readFile("docs", doc.id, "logo", { user: null })).rejects.toThrow();
  });

  it("only filters files with exists and never sorts them", async () => {
    const { qb } = await setup();
    await qb.create("docs", { title: "a", logo: { name: "a.png", bytes: png } }, user);
    await qb.create("docs", { title: "b" }, user);
    const found = await qb.find("docs", { where: { logo: { exists: true } } }, user);
    expect(found.docs.map((doc) => doc.title)).toEqual(["a"]);
    await expect(
      qb.find("docs", { where: { logo: { eq: "x" } } as never }, user),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(qb.find("docs", { sort: "logo" as never }, user)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
