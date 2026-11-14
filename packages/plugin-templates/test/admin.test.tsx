// @vitest-environment happy-dom
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { createAdminI18n, englishI18n, missingMessages } from "@quickben/admin/i18n";
import { defineConfig, devAuth, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrand, publishTemplate, saveDraft, templates, toDataUrl } from "../src";
import { templatesAdmin, templatesMessages } from "../src/admin";
import {
  archiveAction,
  discardDraftAction,
  pdfAction,
  previewAction,
  publishAction,
  restoreAction,
  saveBrandAction,
  saveDraftAction,
} from "../src/admin/actions";
import { errorCode, errorKey, toastKey } from "../src/admin/feedback";

import { invoice, letter, doc, p, signature, text, v, system } from "./fixtures";
import { actAs, navigation } from "./next-mocks";

import type { PdfRenderer, TemplatesOptions } from "../src";
import type { AdminExtension, AdminText, PageProps } from "@quickben/admin";
import type { QuickbenUser } from "@quickben/core";
import type { ReactElement } from "react";

const editor: QuickbenUser = { id: "ed", email: "ed@example.com", roles: ["editor"] };
const viewer: QuickbenUser = { id: "vi", email: "vi@example.com" };
const ok = (word: string) => doc(p(text(word)), signature);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0]);

function makeConfig(options: Partial<TemplatesOptions> = {}) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [],
    plugins: [
      templates({
        kinds: [invoice, letter],
        access: { manage: ({ user }) => user?.roles?.includes("editor") === true },
        ...options,
      }),
    ],
    auth: devAuth(),
  });
}

let config: ReturnType<typeof makeConfig>;
let extension: AdminExtension;
const pdfRender = vi.fn<PdfRenderer["render"]>(() =>
  Promise.resolve(new Uint8Array([37, 80, 68, 70])),
);

beforeEach(() => {
  config = makeConfig({ pdf: { render: pdfRender } });
  extension = templatesAdmin(config, { basePath: "/admin/" });
});

afterEach(() => {
  cleanup();
  actAs(null);
});

const pageProps: PageProps = {
  user: null,
  basePath: "/admin",
  segments: [],
  searchParams: {},
  i18n: englishI18n,
  serverFunction: () => Promise.resolve({ status: "options", options: [] }),
};
const spanish = createAdminI18n({ locale: "es", timeZone: "UTC", overrides: {} });
const shown = (value: AdminText | undefined, i18n = englishI18n) =>
  typeof value === "function" ? value(i18n) : i18n.text(value);

async function renderPage(path: string, props: Partial<PageProps> = {}) {
  const page = extension.pages?.find((x) => x.path === path);
  const Page = page?.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ ...pageProps, ...props }));
}

describe("templatesAdmin", () => {
  it("adds the Templates and Brand pages", () => {
    expect(extension.pages?.map((x) => [x.path, shown(x.label), shown(x.group)])).toEqual([
      ["templates", "Templates", "Documents"],
      ["brand", "Brand", "Documents"],
    ]);
    expect(extension.pages?.map((x) => [shown(x.label, spanish), shown(x.group, spanish)])).toEqual(
      [
        ["Plantillas", "Documentos"],
        ["Marca", "Documentos"],
      ],
    );
    expect(extension.catalogs).toEqual([templatesMessages]);
    expect(templatesAdmin(config, { group: "Docs" }).pages?.[0]?.group).toBe("Docs");
  });

  it("lists kinds with their status", async () => {
    const qb = await getQuickben(config);
    await publishTemplate(qb, "invoice", { user: editor }, { content: ok("x") });
    await saveDraft(qb, "invoice", ok("y"), { user: editor });
    actAs(editor);
    await renderPage("templates");
    expect(screen.getByRole("heading", { level: 1, name: "Document templates" })).toBeTruthy();
    expect(screen.getByText("Published · v1")).toBeTruthy();
    expect(screen.getByText("Draft · v2")).toBeTruthy();
    expect(screen.getByText("Not published")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Invoice" }).getAttribute("href")).toBe(
      "/admin/templates/invoice",
    );
  });

  it("shows a message instead of the list when the user cannot read", async () => {
    await renderPage("templates");
    expect(screen.getByText("Sign in again to continue.")).toBeTruthy();
  });

  it("opens the editor of a kind, read-only without the manage rule", async () => {
    actAs(editor);
    await renderPage("templates", { segments: ["invoice"] });
    expect(screen.getByRole("heading", { level: 1, name: "Invoice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();
    cleanup();
    actAs(viewer);
    await renderPage("templates", { segments: ["invoice"] });
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    cleanup();
    await renderPage("templates", { segments: ["nope"] });
    expect(screen.getByText(/no template kind/)).toBeTruthy();
    cleanup();
    actAs(null);
    await renderPage("templates", { segments: ["invoice"] });
    expect(screen.getByText("Sign in again to continue.")).toBeTruthy();
  });
});

describe("template actions", () => {
  it("saves, previews, publishes, restores, archives and discards", async () => {
    actAs(editor);
    const saved = await saveDraftAction("/admin", "invoice", doc(p(v("nope"))));
    expect(saved).toEqual({
      ok: true,
      value: {
        number: 1,
        issues: [
          { path: [0, 0], message: 'Unknown variable "nope"' },
          { path: [], message: "Add a signature block" },
        ],
      },
    });
    const preview = await previewAction("/admin", "invoice", ok("Hello"));
    expect(preview.ok && preview.value.html).toContain("Hello");
    expect(await previewAction("/admin", "invoice", "bad")).toMatchObject({
      ok: false,
      code: "invalid",
    });

    const refused = await publishAction("/admin", "invoice", doc(p()));
    expect(refused).toEqual({
      ok: false,
      code: "issues",
      issues: [{ path: [], message: "Add a signature block" }],
    });
    expect(await publishAction("/admin", "invoice", ok("v1"))).toEqual({
      ok: true,
      value: { number: 1 },
    });

    const qb = await getQuickben(config);
    const { versions } = await import("../src").then((m) =>
      m.getTemplate(qb, "invoice", { user: editor }),
    );
    const restored = await restoreAction("/admin", "invoice", versions[0]?.id ?? "");
    expect(restored).toEqual({ ok: true, value: { content: ok("v1") } });
    expect(await discardDraftAction("/admin", "invoice")).toEqual({
      ok: true,
      value: { content: ok("v1") },
    });
    expect(await archiveAction("/admin", "invoice")).toEqual({ ok: true, value: null });
    expect(await archiveAction("/admin", "invoice")).toMatchObject({
      ok: false,
      code: "not-found",
    });
    expect(await discardDraftAction("/admin", "letter")).toEqual({
      ok: true,
      value: { content: null },
    });
  });

  it("downloads a PDF preview", async () => {
    actAs(editor);
    expect(await pdfAction("/admin", "invoice", ok("x"))).toEqual({
      ok: true,
      value: { base64: "JVBERg==", fileName: "invoice-preview.pdf" },
    });
  });

  it("refuses users without the manage rule and unknown instances", async () => {
    actAs(viewer);
    expect(await saveDraftAction("/admin", "invoice", ok("x"))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    await expect(saveDraftAction("/other", "invoice", ok("x"))).rejects.toThrow("not ready");
    await expect(saveDraftAction(1 as unknown as string, "invoice", ok("x"))).rejects.toThrow(
      TypeError,
    );
  });
});

describe("brand page and action", () => {
  function form(entries: Record<string, string | File>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
  }
  const save = async (data: FormData) => {
    await expect(saveBrandAction("/admin", data)).rejects.toThrow(/NEXT_REDIRECT/);
    return navigation.redirects.at(-1);
  };

  it("saves fields, a logo and a custom font", async () => {
    actAs(editor);
    const logo = new File([png], "logo.png", { type: "image/png" });
    const regular = new File([woff2], "Brand-Regular.woff2");
    expect(
      await save(
        form({
          displayName: " Acme ",
          legalName: "Acme Inc.",
          primaryColor: "#AA0000",
          font: "serif",
          logo,
          fontRegular: regular,
          fontBold: regular,
        }),
      ),
    ).toBe("/admin/brand?toast=brand-saved");
    const qb = await getQuickben(config);
    const brand = await getBrand(qb, system);
    expect(brand).toMatchObject({
      displayName: "Acme",
      legalName: "Acme Inc.",
      primaryColor: "#aa0000",
      font: "custom",
    });
    expect(brand?.logo).toBe(toDataUrl(png, "image/png"));
    expect(brand?.customFont).toMatchObject({ name: "Brand-Regular" });

    await renderPage("brand", { searchParams: { toast: "brand-saved" } });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Display name" }).value).toBe(
      "Acme",
    );
    expect(screen.getByRole("img", { name: "Current logo" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Brand saved");
    expect(screen.getByTitle("Brand preview")).toBeTruthy();
    cleanup();

    expect(await save(form({ removeLogo: "on", removeFont: "on", font: "custom" }))).toBe(
      "/admin/brand?toast=brand-saved",
    );
    expect(await getBrand(qb, system)).toMatchObject({
      logo: null,
      customFont: null,
      font: "sans",
    });
  });

  it("reports invalid files and colors with fixed messages", async () => {
    actAs(editor);
    const fake = new File([woff2], "logo.png", { type: "image/png" });
    expect(await save(form({ logo: fake }))).toBe("/admin/brand?error=invalid-logo");
    expect(await save(form({ fontRegular: new File([png], "x.woff2") }))).toBe(
      "/admin/brand?error=invalid-font",
    );
    expect(await save(form({ primaryColor: "red" }))).toBe("/admin/brand?error=invalid-color");
    expect(await save(form({ logo: new File([png], "l", { type: "" }) }))).toBe(
      "/admin/brand?toast=brand-saved",
    );
    actAs(viewer);
    expect(await save(form({ displayName: "x" }))).toBe("/admin/brand?error=forbidden");
    await renderPage("brand", { searchParams: { error: "forbidden" } });
    expect(screen.getByText("Your role cannot change the brand.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("not allowed");
  });

  it("stores files through the asset store", async () => {
    const saveAsset = vi.fn(() => Promise.resolve("asset-1"));
    config = makeConfig({
      assets: {
        save: saveAsset,
        load: () => Promise.resolve({ bytes: png, mimeType: "image/png" }),
      },
    });
    extension = templatesAdmin(config);
    actAs(editor);
    expect(await save(form({ logo: new File([png], "logo.png") }))).toBe(
      "/admin/brand?toast=brand-saved",
    );
    expect((await getBrand(await getQuickben(config), system))?.logo).toBe("asset-1");
    await renderPage("brand");
    expect(screen.getByRole("img", { name: "Current logo" }).getAttribute("src")).toMatch(
      /^data:image\/png/,
    );
  });

  it("previews a sample when no kind has a template", async () => {
    config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [templates({ kinds: [letter] })],
      auth: devAuth(),
    });
    extension = templatesAdmin(config);
    actAs(editor);
    await renderPage("brand");
    await waitFor(() => {
      expect(screen.getByTitle("Brand preview").getAttribute("srcdoc")).toContain("Document title");
    });
    cleanup();
    config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [templates({ kinds: [] })],
      auth: devAuth(),
    });
    extension = templatesAdmin(config);
    await renderPage("brand");
    expect(screen.getByTitle("Brand preview").getAttribute("srcdoc")).toContain("Document title");
  });
});

describe("feedback", () => {
  it("maps errors to codes and codes to messages", async () => {
    const { ConflictError, QuickbenError, ValidationError } = await import("@quickben/core");
    const { RendererUnavailableError, NoDraftError } = await import("../src");
    expect(errorCode(new ConflictError("x"))).toBe("conflict");
    expect(errorCode(new RendererUnavailableError("x"))).toBe("pdf-unavailable");
    expect(errorCode(new NoDraftError())).toBe("no-draft");
    expect(errorCode(new ValidationError([{ path: "organization", message: "x" }]))).toBe(
      "organization",
    );
    expect(errorCode(new ValidationError([{ path: "x", message: "x" }]))).toBe("invalid");
    expect(errorCode(Object.assign(new QuickbenError("FORBIDDEN", "x"), { reason: "none" }))).toBe(
      "organization",
    );
    expect(errorCode(new QuickbenError("CONFIG", "x"))).toBe("failed");
    expect(errorCode(null)).toBe("failed");
    expect(toastKey("brand-saved")).toBe("toast.brand-saved");
    expect(toastKey("nope")).toBeUndefined();
    expect(errorKey("conflict")).toBe("error.conflict");
    expect(errorKey(3)).toBeUndefined();
  });
});

describe("messages", () => {
  it("has every key in Spanish", () => {
    expect(missingMessages(templatesMessages)).toEqual([]);
  });

  it("renders the pages in Spanish, with per-locale kind labels", async () => {
    config = makeConfig({
      kinds: [{ ...invoice, label: { en: "Invoice", es: "Factura" }, description: "Sent." }],
    });
    extension = templatesAdmin(config);
    actAs(editor);
    await renderPage("templates", { i18n: spanish });
    expect(
      screen.getByRole("heading", { level: 1, name: "Plantillas de documentos" }),
    ).toBeTruthy();
    expect(screen.getByText("Plantilla base")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Editar Factura" })).toBeTruthy();
    cleanup();
    await renderPage("templates", { segments: ["invoice"], i18n: spanish });
    expect(screen.getByRole("heading", { level: 1, name: "Factura" })).toBeTruthy();
    cleanup();
    await renderPage("templates", { segments: ["nope"], i18n: spanish });
    expect(screen.getByText("No existe el tipo de plantilla “nope”.")).toBeTruthy();
    cleanup();
    actAs(viewer);
    await renderPage("brand", { i18n: spanish, searchParams: { error: "forbidden" } });
    expect(screen.getByText("Tu rol no puede cambiar la marca.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("No tienes permiso");
    expect(screen.getByRole("option", { name: "Monoespaciada" })).toBeTruthy();
  });

  it("uses overrides from the config", async () => {
    actAs(editor);
    const i18n = createAdminI18n({
      locale: "en",
      timeZone: "UTC",
      overrides: { "templates.list.title": "Letters", "templates.brand.title": "Letterhead" },
    });
    await renderPage("templates", { i18n });
    expect(screen.getByRole("heading", { level: 1, name: "Letters" })).toBeTruthy();
    cleanup();
    await renderPage("brand", { i18n });
    expect(screen.getByRole("heading", { level: 1, name: "Letterhead" })).toBeTruthy();
  });
});

describe("styles", () => {
  const escape = (cls: string) => `.${cls.replaceAll(/[:./[\]()%,]/g, (c) => "\\" + c)}`;
  async function sources() {
    const dir = join(import.meta.dirname, "../src/admin");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".tsx"));
    return Promise.all(
      files.map(async (file) => ({ file, source: await readFile(join(dir, file), "utf8") })),
    );
  }

  it("uses only qb: classes that exist in @quickben/admin/styles.css", async () => {
    const require = createRequire(import.meta.url);
    const adminDir = dirname(require.resolve("@quickben/admin/package.json"));
    const css = await readFile(join(adminDir, "dist/styles.css"), "utf8");
    const missing: string[] = [];
    for (const { file, source } of await sources()) {
      for (const [cls] of source.matchAll(/(?<![\w-])qb:[\w:./[\]()%,-]+/g)) {
        if (!css.includes(escape(cls))) missing.push(`${file}: ${cls}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("uses only qbt: classes that exist in the built styles.css, and no palette colors", async () => {
    const css = await readFile(join(import.meta.dirname, "../dist/styles.css"), "utf8");
    const missing: string[] = [];
    const palette: string[] = [];
    for (const { file, source } of await sources()) {
      for (const [cls] of source.matchAll(/(?<![\w-])qbt:[\w:./[\]()%,-]+/g)) {
        if (!css.includes(escape(cls))) missing.push(`${file}: ${cls}`);
        if (/-(zinc|red|blue|emerald|amber|violet|rose|white|black)\b/.test(cls)) palette.push(cls);
      }
    }
    expect(missing).toEqual([]);
    expect(palette).toEqual([]);
    const source = await readFile(join(import.meta.dirname, "../src/admin/styles.css"), "utf8");
    expect(source).not.toMatch(/--qbt-color-|rgb\(/);
  });
});
