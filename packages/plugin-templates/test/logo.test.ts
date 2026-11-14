import { createQuickben, defineConfig, memoryStorage, ValidationError } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";

import { getBrand, loadBrand, migrateBrandLogos, saveBrand, templates, toDataUrl } from "../src";
import { brandInput } from "../src/admin/brand-input";
import { logoDataUrl } from "../src/logo";

import { invoice, system } from "./fixtures";

import type { TemplatesOptions } from "../src";
import type { FileRef, StorageAdapter } from "@quickben/core";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

function setup(options: { storage?: StorageAdapter; templates?: Partial<TemplatesOptions> } = {}) {
  const storage = options.storage ?? memoryStorage();
  const config = defineConfig({
    db: memoryAdapter(),
    storage,
    collections: [],
    plugins: [templates({ kinds: [invoice], ...options.templates })],
  });
  return createQuickben(config).then((qb) => ({
    qb,
    storage: storage as ReturnType<typeof memoryStorage>,
  }));
}

function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("brand logo files", () => {
  it("stores an uploaded logo as a file and renders it", async () => {
    const { qb, storage } = await setup();
    const data = await brandInput(qb, form({ logo: new File([png], "Logo.png") }));
    const brand = await saveBrand(qb, data, system);
    const ref = brand.logoFile as FileRef;
    expect(ref).toMatchObject({ name: "Logo.png", mime: "image/png" });
    expect(brand.logo).toBeNull();
    expect(storage.objects.has(ref.key)).toBe(true);
    expect((await loadBrand(qb)).logo).toBe(toDataUrl(png, "image/png"));
    // A draft logo (preview) wins over the stored file.
    const draft = toDataUrl(jpeg, "image/jpeg");
    expect((await loadBrand(qb, system, { logo: draft })).logo).toBe(draft);
  });

  it("replaces and removes the logo file", async () => {
    const { qb, storage } = await setup();
    const first = await saveBrand(
      qb,
      await brandInput(qb, form({ logo: new File([png], "a.png") })),
      system,
    );
    const second = await saveBrand(
      qb,
      await brandInput(qb, form({ logo: new File([jpeg], "b.jpg") })),
      system,
    );
    expect(storage.objects.has((first.logoFile as FileRef).key)).toBe(false);
    expect((second.logoFile as FileRef).mime).toBe("image/jpeg");
    await saveBrand(qb, await brandInput(qb, form({ removeLogo: "on" })), system);
    expect(await getBrand(qb, system)).toMatchObject({ logoFile: null, logo: null });
    expect(storage.objects.size).toBe(0);
    expect((await loadBrand(qb)).logo).toBeNull();
  });

  it("refuses files that are not PNG, JPEG or WebP", async () => {
    const { qb } = await setup();
    const data = await brandInput(qb, form({ logo: new File(["%PDF-1.7"], "a.png") }));
    await expect(saveBrand(qb, data, system)).rejects.toMatchObject({
      issues: [{ path: "logoFile" }],
    });
    await expect(saveBrand(qb, data, system)).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses the plugin's own storage", async () => {
    const own = memoryStorage();
    const { qb, storage } = await setup({ templates: { storage: own } });
    await saveBrand(qb, await brandInput(qb, form({ logo: new File([png], "a.png") })), system);
    expect(own.objects.size).toBe(1);
    expect(storage.objects.size).toBe(0);
    expect((await loadBrand(qb)).logo).toBe(toDataUrl(png, "image/png"));
  });

  it("renders nothing when the stored object is gone", async () => {
    const { qb, storage } = await setup();
    const brand = await saveBrand(
      qb,
      await brandInput(qb, form({ logo: new File([png], "a.png") })),
      system,
    );
    storage.objects.clear();
    const ref = { ...(brand.logoFile as FileRef), sha256: "f".repeat(64) };
    expect(await logoDataUrl(qb, ref)).toBeNull();
  });
});

describe("migrateBrandLogos", () => {
  it("moves data URLs and asset references to logo files", async () => {
    const load = (ref: string) =>
      Promise.resolve(ref === "asset-1" ? { bytes: jpeg, mimeType: "image/jpeg" } : null);
    const { qb, storage } = await setup({
      templates: { assets: { load, save: () => Promise.resolve("x") } },
    });
    // Without tenancy there is one brand, so the cases run one after the other.
    const logoName = async () =>
      ((await getBrand(qb, system))?.logoFile as FileRef | null)?.name ?? null;
    expect(await migrateBrandLogos(qb)).toEqual({ migrated: 0, skipped: 0 });
    await saveBrand(qb, { logo: toDataUrl(png, "image/png") }, system);
    expect(await migrateBrandLogos(qb)).toEqual({ migrated: 1, skipped: 0 });
    expect(await logoName()).toBe("logo.png");
    expect((await getBrand(qb, system))?.logo).toBeNull();

    await saveBrand(qb, { logoFile: null, logo: "asset-1" }, system);
    expect(await migrateBrandLogos(qb)).toEqual({ migrated: 1, skipped: 0 });
    expect(await logoName()).toBe("logo.jpg");
    expect(storage.objects.size).toBe(1);

    // A brand that has a file keeps it; an unreadable old logo is skipped.
    await saveBrand(qb, { logo: "gone" }, system);
    expect(await migrateBrandLogos(qb)).toEqual({ migrated: 0, skipped: 0 });
    await saveBrand(qb, { logoFile: null }, system);
    expect(await migrateBrandLogos(qb)).toEqual({ migrated: 0, skipped: 1 });
    expect(await logoName()).toBeNull();
  });
});

describe("without storage", () => {
  it("keeps the logo as a data URL", async () => {
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [templates({ kinds: [invoice] })],
    });
    const qb = await createQuickben(config);
    const data = await brandInput(qb, form({ logo: new File([png], "a.png") }));
    expect(data.logo).toBe(toDataUrl(png, "image/png"));
    expect(data).not.toHaveProperty("logoFile");
    const brand = await saveBrand(qb, data, system);
    expect(
      await logoDataUrl(qb, {
        key: "k",
        name: "a",
        mime: "image/png",
        size: 1,
        sha256: "0".repeat(64),
      }),
    ).toBeNull();
    expect(brand.logoFile).toBeNull();
  });
});
