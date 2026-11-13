import { NotFoundError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import {
  loadBrand,
  publishTemplate,
  RendererUnavailableError,
  renderPdf,
  renderTemplate,
  saveBrand,
  saveDraft,
  toDataUrl,
} from "../src";

import { alice, as, doc, p, setup, signature, system, text, v } from "./fixtures";

import type { PdfRenderer } from "../src";

const ok = (word: string) => doc(p(text(word), v("customer.name")), signature);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);

describe("renderTemplate", () => {
  it("renders the published version, else the base template", async () => {
    const qb = await setup();
    const base = await renderTemplate(qb, { kind: "invoice", data: { invoice: { number: "7" } } });
    expect(base.version).toBeNull();
    expect(base.html).toContain('Invoice <span class="var">7</span>');
    await publishTemplate(qb, "invoice", as(alice), { content: ok("Hello ") });
    const published = await renderTemplate(qb, {
      kind: "invoice",
      data: { customer: { name: "Bob" } },
    });
    expect(published.version?.number).toBe(1);
    expect(published.html).toContain('Hello <span class="var">Bob</span>');
  });

  it("renders the draft, given content or fails without a template", async () => {
    const qb = await setup();
    await expect(renderTemplate(qb, { kind: "letter", data: {} })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(renderTemplate(qb, { kind: "nope", data: {} })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const given = await renderTemplate(qb, {
      kind: "letter",
      data: { recipient: "Ann" },
      source: { content: doc(p(v("recipient"))) },
    });
    expect(given.html).toContain(">Ann<");
    await publishTemplate(qb, "invoice", as(alice), { content: ok("Published ") });
    await saveDraft(qb, "invoice", ok("Draft "), as(alice));
    const draft = await renderTemplate(
      qb,
      { kind: "invoice", data: {}, source: "draft" },
      as(alice),
    );
    expect(draft.html).toContain("Draft ");
    expect(draft.version?.number).toBe(2);
    expect(
      (await renderTemplate(qb, { kind: "invoice", data: {}, source: "published" })).html,
    ).toContain("Published ");
  });

  it("uses the stored brand, with overrides", async () => {
    const qb = await setup();
    await saveBrand(
      qb,
      { displayName: "Acme", legalName: "Acme Inc.", logo: toDataUrl(png, "image/png") },
      system,
    );
    const rendered = await renderTemplate(qb, {
      kind: "invoice",
      data: {},
      brand: { primaryColor: "#00ff00", accentColor: "nope", footer: "  Bye  ", displayName: " " },
      title: "Custom",
      reference: "Ref 1",
    });
    expect(rendered.title).toBe("Custom");
    expect(rendered.html).toContain("color:#00ff00");
    expect(rendered.letterhead).toContain("data:image/png;base64,");
    expect(rendered.letterhead).toContain('<div class="left">Bye</div>');
    expect(rendered.letterhead).toContain("1.5pt solid #1d4ed8");
    expect(rendered.author).toBe("Acme Inc.");
  });
});

describe("brand assets and fonts", () => {
  it("loads assets through the store, caches them and drops broken ones", async () => {
    const load = vi.fn((ref: string) =>
      Promise.resolve(ref === "logo-1" ? { bytes: png, mimeType: "image/png" } : null),
    );
    const qb = await setup({ assets: { load, save: () => Promise.resolve("ref") } });
    await saveBrand(qb, { logo: "logo-1" }, system);
    expect((await loadBrand(qb)).logo).toMatch(/^data:image\/png;base64,/);
    expect((await loadBrand(qb)).logo).toMatch(/^data:image\/png;base64,/);
    expect(load).toHaveBeenCalledTimes(1);
    await saveBrand(qb, { logo: "gone" }, system);
    expect((await loadBrand(qb)).logo).toBeNull();
    expect((await loadBrand(qb, system, { logo: "data:nope" })).logo).toBeNull();

    const plain = await setup();
    await saveBrand(plain, { logo: "logo-1" }, system);
    expect((await loadBrand(plain)).logo).toBeNull();
  });

  it("uses custom, registered and system fonts", async () => {
    const faces = vi.fn(() =>
      Promise.resolve([
        { weight: 400 as const, style: "normal" as const, url: "data:font/woff2;base64,AA" },
      ]),
    );
    const qb = await setup({ fonts: [{ key: "inter", label: "Inter", generic: "serif", faces }] });
    expect(await loadBrand(qb)).toMatchObject({
      faces: [],
      stack: expect.stringContaining("sans-serif") as string,
    });
    expect((await loadBrand(qb, system, { font: "mono" })).stack).toContain("monospace");
    expect((await loadBrand(qb, system, { font: "unknown" })).stack).toContain("sans-serif");
    const inter = await loadBrand(qb, system, { font: "inter" });
    await loadBrand(qb, system, { font: "inter" });
    expect(inter.faces).toHaveLength(1);
    expect(inter.stack).toContain("serif");
    expect(faces).toHaveBeenCalledTimes(1);

    const font = toDataUrl(woff2, "font/woff2");
    await saveBrand(
      qb,
      { font: "custom", customFont: { name: "Mine", regular: font, bold: font } },
      system,
    );
    expect((await loadBrand(qb)).faces.map((f) => f.weight)).toEqual([400, 700]);
    await saveBrand(qb, { customFont: { name: "Mine", regular: "missing-ref" } }, system);
    expect((await loadBrand(qb)).faces).toEqual([]);
  });
});

describe("renderPdf", () => {
  it("hands the rendered HTML to the renderer", async () => {
    const render = vi.fn<PdfRenderer["render"]>(() => Promise.resolve(new Uint8Array([1, 2])));
    const qb = await setup({ pdf: { render } });
    const result = await renderPdf(qb, { kind: "invoice", data: {} });
    expect(result).toEqual({ pdf: new Uint8Array([1, 2]), title: "Invoice", version: null });
    expect(render.mock.calls[0]?.[0]).toMatchObject({ title: "Invoice", author: null });
  });

  it("fails without a renderer", async () => {
    const qb = await setup();
    await expect(renderPdf(qb, { kind: "invoice", data: {} })).rejects.toBeInstanceOf(
      RendererUnavailableError,
    );
  });
});
