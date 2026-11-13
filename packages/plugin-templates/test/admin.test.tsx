// @vitest-environment happy-dom
import { defineConfig, devAuth, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrand, publishTemplate, saveDraft, templates, toDataUrl } from "../src";
import { templatesAdmin } from "../src/admin";
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
import { errorCode, errorMessage, toastMessage } from "../src/admin/feedback";

import { invoice, letter, doc, p, signature, text, v, system } from "./fixtures";
import { actAs, navigation } from "./next-mocks";

import type { PdfRenderer, TemplatesOptions } from "../src";
import type { AdminExtension, PageProps } from "@quickben/admin";
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

const pageProps: PageProps = { user: null, basePath: "/admin", segments: [], searchParams: {} };

async function renderPage(path: string, props: Partial<PageProps> = {}) {
  const page = extension.pages?.find((x) => x.path === path);
  const Page = page?.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ ...pageProps, ...props }));
}

describe("templatesAdmin", () => {
  it("adds the Templates and Brand pages", () => {
    expect(extension.pages?.map((x) => [x.path, x.label, x.group])).toEqual([
      ["templates", "Templates", "Documents"],
      ["brand", "Brand", "Documents"],
    ]);
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
      message: errorMessage("invalid"),
    });

    const refused = await publishAction("/admin", "invoice", doc(p()));
    expect(refused).toEqual({
      ok: false,
      message: "Not published: fix the marked problems first.",
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
      message: errorMessage("not-found"),
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
      message: errorMessage("forbidden"),
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
    expect(toastMessage("brand-saved")).toBe("Brand saved");
    expect(toastMessage("nope")).toBeUndefined();
    expect(errorMessage(3)).toBeUndefined();
  });
});
