// @vitest-environment happy-dom
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  AdminI18nProvider,
  createAdminI18n,
  englishI18n,
  missingMessages,
} from "@quickben/admin/i18n";
import { defineConfig, devAuth, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { getMeta } from "@quickben/next";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { connections, defineProvider } from "../src";
import {
  connectionsAdmin,
  connectionsMessages,
  describeFields,
  describeProvider,
} from "../src/admin";
import {
  deleteAction,
  saveConnectionAction,
  saveCredentialAction,
  testConnectionAction,
  testCredentialAction,
} from "../src/admin/actions";
import { metadataFromForm } from "../src/admin/describe";

import { actAs, navigation } from "./next-mocks";
import { admin, API_KEY, fakeFetch, json, KEY_A, member, staff, system } from "./setup";

import type { AdminExtension, AdminI18n, ViewProps } from "@quickben/admin";
import type { Quickben, QuickbenUser } from "@quickben/core";
import type { ReactElement } from "react";

const identity = defineProvider({
  type: "identity",
  label: "Identity check",
  category: "Identity",
  capabilities: ["identity_verification"],
  baseUrl: { required: true, default: "https://id.test" },
  fields: z.object({
    level: z.coerce.number().int().min(0).max(3).meta({ title: "Level" }),
    mode: z.enum(["fast", "strict"]).default("fast"),
    notify: z.boolean().default(false),
  }),
  test: async ({ baseUrl, fetch, signal }) => {
    const response = await fetch(`${baseUrl ?? ""}/health`, { signal });
    return { ok: response.ok };
  },
});

const fetch = fakeFetch({
  "GET https://id.test/health": () => json({ ok: true }),
  "GET https://api.anthropic.com/v1/models": () => json({}, 401),
});

function makeConfig() {
  return defineConfig({
    db: memoryAdapter(),
    collections: [],
    plugins: [connections({ masterKey: KEY_A, providers: [identity], fetch })],
    auth: devAuth(),
  });
}

let config: ReturnType<typeof makeConfig>;
let extension: AdminExtension;
let qb: Quickben;
let ids: Record<string, string>;

beforeEach(async () => {
  config = makeConfig();
  extension = connectionsAdmin(config, { basePath: "/admin/" });
  qb = await getQuickben(config);
  const key = await qb.create("credentials", { name: "Main key", secret: API_KEY }, system);
  const spare = await qb.create(
    "credentials",
    { name: "Spare", secret: "sk-spare-000000001" },
    system,
  );
  const claude = await qb.create(
    "connections",
    { name: "Claude", providerType: "anthropic", credential: key.id },
    system,
  );
  const check = await qb.create(
    "connections",
    { name: "ID", providerType: "identity", credential: key.id, metadata: { level: 2 } },
    system,
  );
  ids = { key: key.id, spare: spare.id, claude: claude.id, check: check.id };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  actAs(null);
});

async function viewProps(user: QuickbenUser, slug: string, extra: Partial<ViewProps> = {}) {
  actAs(user);
  const meta = await getMeta(qb, { user });
  const collection = meta.collections.find((c) => c.slug === slug)!;
  return {
    collection,
    user,
    basePath: "/admin",
    searchParams: {},
    i18n: englishI18n,
    ...extra,
  } satisfies ViewProps;
}

async function renderView(slug: string, kind: "list" | "edit", props: ViewProps) {
  const View = extension.views![slug]![kind]! as unknown as (p: ViewProps) => Promise<ReactElement>;
  const element = await View(props);
  return render(<AdminI18nProvider value={props.i18n.data}>{element}</AdminI18nProvider>);
}

function i18nFor(locale: string, overrides: Record<string, string> = {}): AdminI18n {
  return createAdminI18n({ locale, timeZone: "UTC", overrides });
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function redirected(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(/NEXT_REDIRECT/);
  return navigation.redirects.at(-1);
}

const idle = { status: "idle" } as const;

describe("connectionsAdmin", () => {
  it("replaces the list and edit views of both collections", () => {
    expect(Object.keys(extension.views ?? {})).toEqual(["connections", "credentials"]);
  });

  it("puts both collections in the Integrations group", () => {
    expect(qb.collections.connections?.admin.group).toEqual({
      en: "Integrations",
      es: "Integraciones",
    });
    expect(qb.collections.credentials?.admin.group).toEqual({
      en: "Integrations",
      es: "Integraciones",
    });
  });

  it("registers its catalog, complete in Spanish", () => {
    expect(extension.catalogs).toEqual([connectionsMessages]);
    expect(missingMessages(connectionsMessages)).toEqual([]);
  });
});

describe("locales", () => {
  it("renders the connections list in Spanish", async () => {
    actAs(admin);
    await testConnectionAction("/admin", ids.check!);
    await renderView(
      "connections",
      "list",
      await viewProps(admin, "connections", { i18n: i18nFor("es") }),
    );
    expect(screen.getByRole("heading", { name: "Conexiones" })).toBeTruthy();
    const row = screen.getByRole("link", { name: "Claude" }).closest("tr")!;
    expect(within(row).getByText("Anthropic · Modelos de IA")).toBeTruthy();
    expect(within(row).getByText("Sin probar")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Probar" })).toBeTruthy();
    const tested = screen.getByRole("link", { name: "ID" }).closest("tr")!;
    expect(within(tested).getByText("Funciona")).toBeTruthy();
    expect(tested.querySelector("time")?.textContent).toMatch(/ahora|segundo/);
  });

  it("renders forms, kinds and plurals in Spanish", async () => {
    await renderView(
      "credentials",
      "list",
      await viewProps(admin, "credentials", { i18n: i18nFor("es-CL") }),
    );
    expect(screen.getByText("2 conexiones")).toBeTruthy();
    expect(screen.getAllByText("Clave de API").length).toBeGreaterThan(0);
    cleanup();
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", {
        searchParams: { provider: "http" },
        i18n: i18nFor("es"),
      }),
    );
    expect(screen.getByRole("heading", { name: "Nueva conexión: API HTTP" })).toBeTruthy();
    expect(screen.getByLabelText(/Ruta de prueba/)).toBeTruthy();
    expect(screen.getByText("Un GET a esta ruta debe responder 2xx.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear conexión" })).toBeTruthy();
  });

  it("lets overrides win and falls back to a provider's own texts", async () => {
    const i18n = i18nFor("es", {
      "connections.list.title": "Integraciones",
      "connections.provider.identity.description": "Verificación de identidad.",
    });
    await renderView("connections", "list", await viewProps(admin, "connections", { i18n }));
    expect(screen.getByRole("heading", { name: "Integraciones" })).toBeTruthy();
    const view = describeProvider(identity, i18n);
    expect(view.description).toBe("Verificación de identidad.");
    expect(view.label).toBe("Identity check");
    expect(view.category).toBe("Identity");
    expect(view.fields.map((field) => field.label)).toEqual(["Level", "Mode", "Notify"]);
  });
});

describe("connection views", () => {
  it("lists connections with provider, masked credential and state", async () => {
    await renderView("connections", "list", await viewProps(admin, "connections"));
    const row = screen.getByRole("link", { name: "Claude" }).closest("tr")!;
    expect(within(row).getByText("Anthropic · AI models")).toBeTruthy();
    expect(within(row).getByText("Main key (•••• cdef)")).toBeTruthy();
    expect(within(row).getByText("Not tested")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Test" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New connection" }).getAttribute("href")).toBe(
      "/admin/connections/new",
    );
    expect(document.body.innerHTML).not.toContain(API_KEY);
  });

  it("shows the state of the last test", async () => {
    actAs(admin);
    await testConnectionAction("/admin", ids.check!);
    await testConnectionAction("/admin", ids.claude!);
    await renderView("connections", "list", await viewProps(admin, "connections"));
    const table = screen.getByRole("table");
    expect(within(table).getByText("Working")).toBeTruthy();
    expect(within(table).getByText("Failed")).toBeTruthy();
    cleanup();
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { id: ids.claude! }),
    );
    expect(screen.getByText("Anthropic rejected the credential (HTTP 401).")).toBeTruthy();
  });

  it("is read-only for staff: no New or Test buttons", async () => {
    await renderView("connections", "list", await viewProps(staff, "connections"));
    expect(screen.queryByRole("link", { name: "New connection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
  });

  it("shows an empty list", async () => {
    await qb.delete("connections", ids.claude!, system);
    await qb.delete("connections", ids.check!, system);
    await renderView("connections", "list", await viewProps(admin, "connections"));
    expect(screen.getByText(/No connections yet/)).toBeTruthy();
  });

  it("picks a provider grouped by category, then shows its form", async () => {
    await renderView("connections", "edit", await viewProps(admin, "connections"));
    const groups = screen
      .getAllByRole("region")
      .map((region) => region.querySelector("h2")?.textContent);
    expect(groups).toEqual(["AI models", "Other", "Identity"]);
    const anthropic = screen.getByRole("link", { name: /Anthropic/ });
    expect(anthropic.getAttribute("href")).toBe("/admin/connections/new?provider=anthropic");
    expect(anthropic.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    cleanup();
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { searchParams: { provider: ["identity"] } }),
    );
    expect(screen.getByRole("heading", { name: "New Identity check connection" })).toBeTruthy();
    expect(screen.getByLabelText(/Level/)).toBeTruthy();
    expect(screen.getByLabelText("Mode")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create connection" })).toBeTruthy();
  });

  it("shows a connection with its form, Test button and status", async () => {
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { id: ids.check! }),
    );
    expect(screen.getByRole("heading", { name: "ID" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Level/).value).toBe("2");
    expect(screen.getByLabelText<HTMLSelectElement>(/Credential/).value).toBe(ids.key);
    expect(screen.getByText("Never tested.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete connection" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Test" })).toHaveLength(1);
  });

  it("explains an unknown provider", async () => {
    await qb.db.update({
      collection: "connections",
      id: ids.claude!,
      data: { providerType: "gone" },
    });
    await renderView(
      "connections",
      "edit",
      await viewProps(staff, "connections", { id: ids.claude! }),
    );
    expect(screen.getByText(/is not registered/)).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
  });
});

describe("list search and filters", () => {
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).queryAllByRole("link")[0]?.textContent ?? row.textContent);

  it("filters connections by name, provider, enabled and state", async () => {
    await qb.update("connections", ids.check!, { enabled: false }, system);
    const list = async (searchParams: Record<string, string>) => {
      cleanup();
      await renderView(
        "connections",
        "list",
        await viewProps(admin, "connections", { searchParams }),
      );
    };
    await list({});
    const search = screen.getByRole("search");
    expect(within(search).getByLabelText("Search by name")).toBeTruthy();
    expect(within(search).getByLabelText("Provider")).toBeTruthy();
    expect(within(search).queryByRole("link", { name: "Clear" })).toBeNull();
    await list({ q: "clau" });
    expect(names()).toEqual(["Claude"]);
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
      "/admin/connections",
    );
    await list({ "filter.provider": "identity" });
    expect(names()).toEqual(["ID"]);
    await list({ "filter.enabled": "false" });
    expect(names()).toEqual(["ID"]);
    await list({ "filter.state": "untested", "filter.provider": "bogus" });
    expect(names()).toEqual(["Claude", "ID"]);
    await list({ q: "zzz" });
    expect(screen.getByText("No connections match the search or filters.")).toBeTruthy();
  });

  it("filters derived state and use across every page with request access", async () => {
    // Tiny pages exercise the same boundaries as the production 500/1000-row limits.
    const find = qb.find.bind(qb);
    vi.spyOn(qb, "find").mockImplementation((slug, options, ctx) =>
      find(slug, { ...options, limit: 1 }, ctx),
    );
    await testConnectionAction("/admin", ids.check!);
    await renderView(
      "connections",
      "list",
      await viewProps(admin, "connections", {
        searchParams: { "filter.state": "active" },
      }),
    );
    expect(names()).toEqual(["ID"]);
    cleanup();
    // Move the only reference to Spare to the second connections page.
    await qb.update("connections", ids.check!, { credential: ids.spare! }, system);
    await renderView(
      "credentials",
      "list",
      await viewProps(admin, "credentials", {
        searchParams: { "filter.use": "used" },
      }),
    );
    expect(names()).toEqual(["Main key", "Spare"]);
  });

  it("filters credentials by name, kind, use and state", async () => {
    const list = async (searchParams: Record<string, string>) => {
      cleanup();
      await renderView(
        "credentials",
        "list",
        await viewProps(admin, "credentials", { searchParams }),
      );
    };
    await list({ "filter.use": "unused" });
    expect(names()).toEqual(["Spare"]);
    await list({ "filter.use": "used", "filter.kind": "api_key", "filter.state": "untested" });
    expect(names()).toEqual(["Main key"]);
    await list({ q: "nothing" });
    expect(screen.getByText("No credentials match the search or filters.")).toBeTruthy();
  });
});

describe("models row editor", () => {
  it("edits the models of an LLM connection as rows", async () => {
    await qb.update(
      "connections",
      ids.claude!,
      { metadata: { models: [{ id: "claude-haiku-4-5", vision: true, default: true }] } },
      system,
    );
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { id: ids.claude! }),
    );
    const group = screen.getByRole("group", { name: "Models" });
    expect(within(group).getByRole("columnheader", { name: "Model id" })).toBeTruthy();
    expect(within(group).getByRole("columnheader", { name: "Input USD / 1M tokens" })).toBeTruthy();
    expect(within(group).getByLabelText("Model id, row 1")).toHaveProperty(
      "value",
      "claude-haiku-4-5",
    );
    fireEvent.click(within(group).getByRole("button", { name: "Add row" }));
    fireEvent.change(within(group).getByLabelText("Model id, row 2"), {
      target: { value: "claude-haiku-4-5" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
    const cell = within(group).getByLabelText("Model id, row 2");
    await waitFor(() => {
      expect(cell.getAttribute("aria-invalid")).toBe("true");
    });
    expect(within(group).getByText("Duplicate model claude-haiku-4-5")).toBeTruthy();
  });

  it("describes list fields with row columns", () => {
    const fields = describeFields(
      z.object({ items: z.array(z.object({ id: z.string() })).default([]), raw: z.object({}) }),
    );
    expect(fields[0]?.rows?.map((column) => column.key)).toEqual(["id"]);
    expect(fields[1]?.rows).toBeUndefined();
  });
});

describe("credential views", () => {
  it("lists credentials masked, with their use", async () => {
    await renderView("credentials", "list", await viewProps(admin, "credentials"));
    const row = screen.getByRole("link", { name: "Main key" }).closest("tr")!;
    expect(within(row).getByText("•••• cdef")).toBeTruthy();
    expect(within(row).getByText("2 connections")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Spare" }).closest("tr")?.textContent).toContain(
      "Unused",
    );
    expect(document.body.innerHTML).not.toContain(API_KEY);
  });

  it("shows the create form and the detail page without the secret", async () => {
    await renderView("credentials", "edit", await viewProps(admin, "credentials"));
    expect(screen.getByRole("button", { name: "Create credential" })).toBeTruthy();
    cleanup();
    await renderView(
      "credentials",
      "edit",
      await viewProps(admin, "credentials", { id: ids.key! }),
    );
    expect(screen.getByLabelText<HTMLInputElement>(/Replace secret/).value).toBe("");
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(API_KEY);
    expect(document.body.innerHTML).not.toContain("v1:");
  });

  it("switches the secret control with the kind", async () => {
    await renderView("credentials", "edit", await viewProps(admin, "credentials"));
    fireEvent.change(screen.getByLabelText("Kind *"), {
      target: { value: "service_account_json" },
    });
    expect(screen.getByLabelText(/Secret/).tagName).toBe("TEXTAREA");
  });

  it("asks for a provider when testing an unused credential", async () => {
    await renderView(
      "credentials",
      "edit",
      await viewProps(admin, "credentials", { id: ids.spare! }),
    );
    expect(screen.getByText("No connection uses this credential.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    const select = within(dialog).getByLabelText<HTMLSelectElement>("Provider");
    expect([...select.options].map((o) => o.value)).toEqual([
      "anthropic",
      "openai_compatible",
      "google",
      "vertex",
      "http",
      "identity",
    ]);
    fireEvent.change(select, { target: { value: "identity" } });
    fireEvent.submit(select.form!);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/The credential works/);
    });
  });

  it("member cannot see the views' data", async () => {
    actAs(member);
    const meta = await getMeta(qb, { user: member });
    expect(meta.collections.map((c) => c.slug)).toEqual([]);
  });
});

describe("actions", () => {
  it("creates a connection and redirects to it", async () => {
    actAs(admin);
    const target = await redirected(
      saveConnectionAction(
        "/admin",
        null,
        "identity",
        idle,
        form({
          name: "New",
          baseUrl: "",
          credential: ids.key!,
          enabled: "on",
          "metadata.level": "1",
          "metadata.notify": "on",
        }),
      ),
    );
    expect(target).toMatch(/^\/admin\/connections\/.+\?toast=created$/);
    const id = decodeURIComponent(target!.split("/").at(-1)!.split("?")[0]!);
    const saved = await qb.findById("connections", id, {}, system);
    expect(saved).toMatchObject({
      baseUrl: "https://id.test",
      metadata: { level: 1, mode: "fast", notify: true },
    });
  });

  it("returns field errors, also for nested metadata", async () => {
    actAs(admin);
    const state = await saveConnectionAction(
      "/admin",
      ids.claude!,
      "anthropic",
      idle,
      form({ name: "", "metadata.models": '[{"id":""}]', credential: ids.key! }),
    );
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: {
        "metadata.models": expect.stringMatching(/^0\.id: /) as unknown,
        "metadata.models.0.id": expect.any(String) as unknown,
      },
    });
    await expect(
      saveConnectionAction("/admin", null, "nope", idle, form({ name: "x" })),
    ).resolves.toMatchObject({
      status: "error",
      message: { code: "unknownProvider", type: "nope" },
    });
  });

  it("updates a connection; staff are refused", async () => {
    actAs(admin);
    expect(
      await redirected(
        saveConnectionAction(
          "/admin",
          ids.check!,
          "identity",
          idle,
          form({ name: "Renamed", credential: ids.key!, "metadata.level": "3" }),
        ),
      ),
    ).toBe(`/admin/connections/${ids.check!}?toast=saved`);
    actAs(staff);
    await expect(
      saveConnectionAction("/admin", ids.check!, "identity", idle, form({ name: "x" })),
    ).resolves.toMatchObject({
      status: "error",
      message: { text: expect.stringMatching(/denied|not allowed/i) as unknown },
    });
  });

  it("creates and updates credentials; an empty secret keeps the stored one", async () => {
    actAs(admin);
    const target = await redirected(
      saveCredentialAction(
        "/admin",
        null,
        idle,
        form({ name: "New", kind: "api_key", secret: "sk-new-1234567890" }),
      ),
    );
    expect(target).toMatch(/toast=created$/);
    await redirected(
      saveCredentialAction(
        "/admin",
        ids.key!,
        idle,
        form({ name: "Main", kind: "api_key", secret: "" }),
      ),
    );
    expect(await qb.findById("credentials", ids.key!, {}, system)).toMatchObject({
      name: "Main",
      last4: "cdef",
    });
    await expect(
      saveCredentialAction("/admin", null, idle, form({ name: "x", kind: "api_key" })),
    ).resolves.toMatchObject({ fieldErrors: { secret: "Required" } });
  });

  it("refuses to delete a credential in use, deletes otherwise", async () => {
    actAs(admin);
    await expect(deleteAction("/admin", "credentials", ids.key!)).resolves.toMatchObject({
      status: "error",
      message: { text: expect.stringMatching(/used by 2 connection/) as unknown },
    });
    expect(await redirected(deleteAction("/admin", "credentials", ids.spare!))).toBe(
      "/admin/credentials?toast=deleted",
    );
    await expect(deleteAction("/admin", "posts", "x")).rejects.toBeInstanceOf(TypeError);
  });

  it("tests connections and credentials", async () => {
    actAs(admin);
    await expect(testConnectionAction("/admin", ids.check!)).resolves.toMatchObject({
      status: "done",
      ok: true,
      subject: "connection",
    });
    await expect(testConnectionAction("/admin", ids.claude!)).resolves.toMatchObject({
      ok: false,
      error: "Anthropic rejected the credential (HTTP 401).",
    });
    await expect(testCredentialAction("/admin", ids.spare!, {})).resolves.toMatchObject({
      status: "pick-provider",
    });
    await expect(
      testCredentialAction("/admin", ids.spare!, {
        providerType: "identity",
        baseUrl: " https://id.test ",
      }),
    ).resolves.toMatchObject({ ok: true });
    actAs(staff);
    await expect(testConnectionAction("/admin", ids.check!)).resolves.toMatchObject({
      status: "error",
    });
  });

  it("rejects unknown admin keys", async () => {
    await expect(testConnectionAction("/nope", "x")).rejects.toThrow(/not ready/);
    await expect(testConnectionAction(1 as unknown as string, "x")).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("client components", () => {
  it("runs Test on a connection and shows a toast", async () => {
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { id: ids.check! }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /The connection works. Answered in \d+ ms/,
      );
    });
  });

  it("shows field errors from a failed save", async () => {
    await renderView(
      "connections",
      "edit",
      await viewProps(admin, "connections", { searchParams: { provider: "http" } }),
    );
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "API" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create connection" }).closest("form")!);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Check the highlighted fields.");
    });
    expect(screen.getByLabelText(/Base URL/).getAttribute("aria-invalid")).toBe("true");
  });

  it("confirms deletes and shows the refusal", async () => {
    await renderView(
      "credentials",
      "edit",
      await viewProps(admin, "credentials", { id: ids.key! }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete credential" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/used by 2/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete credential" })).toBeTruthy();
  });
});

describe("form helpers", () => {
  it("describes fields from a Zod schema", () => {
    expect(describeFields(identity.fields)).toEqual([
      expect.objectContaining({
        key: "level",
        label: "Level",
        control: "number",
        required: true,
        min: 0,
        max: 3,
      }),
      expect.objectContaining({
        key: "mode",
        label: "Mode",
        control: "select",
        options: ["fast", "strict"],
        default: "fast",
      }),
      expect.objectContaining({ key: "notify", control: "checkbox", required: false }),
    ]);
    expect(describeFields(z.string())).toEqual([]);
    expect(describeFields(z.object({ when: z.date() }))).toEqual([
      expect.objectContaining({ key: "when", control: "text" }),
    ]);
  });

  it("reads metadata from a form by control type", () => {
    const fields = describeFields(
      z.object({ n: z.number(), j: z.array(z.string()), t: z.string(), b: z.boolean() }),
    );
    expect(
      metadataFromForm(
        fields,
        form({ "metadata.n": "4", "metadata.j": '["a"]', "metadata.t": " x " }),
      ),
    ).toEqual({
      n: 4,
      j: ["a"],
      t: "x",
      b: false,
    });
    expect(
      metadataFromForm(fields, form({ "metadata.n": "abc", "metadata.j": "[", "metadata.t": "" })),
    ).toEqual({
      n: "abc",
      j: "[",
      b: false,
    });
  });
});

describe("styles", () => {
  it("uses only classes that exist in @quickben/admin/styles.css", async () => {
    const require = createRequire(import.meta.url);
    const adminDir = dirname(require.resolve("@quickben/admin/package.json"));
    const css = await readFile(join(adminDir, "dist/styles.css"), "utf8");
    const dir = join(import.meta.dirname, "../src/admin");
    const missing: string[] = [];
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".tsx"))) {
      const source = await readFile(join(dir, file), "utf8");
      for (const [cls] of source.matchAll(/qb:[\w:./[\]-]+/g)) {
        const escaped = `.${cls.replaceAll(/[:./[\]]/g, (c) => "\\" + c)}`;
        if (!css.includes(escaped)) missing.push(`${file}: ${cls}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
