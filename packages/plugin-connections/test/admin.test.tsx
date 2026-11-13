// @vitest-environment happy-dom
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig, devAuth, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { getMeta } from "@quickben/next";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { connections, defineProvider } from "../src";
import { connectionsAdmin, describeFields } from "../src/admin";
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

import type { AdminExtension, ViewProps } from "@quickben/admin";
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
  actAs(null);
});

async function viewProps(user: QuickbenUser, slug: string, extra: Partial<ViewProps> = {}) {
  actAs(user);
  const meta = await getMeta(qb, { user });
  const collection = meta.collections.find((c) => c.slug === slug)!;
  return { collection, user, basePath: "/admin", searchParams: {}, ...extra };
}

async function renderView(slug: string, kind: "list" | "edit", props: ViewProps) {
  const View = extension.views![slug]![kind]! as unknown as (p: ViewProps) => Promise<ReactElement>;
  return render(await View(props));
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
    expect(qb.collections.connections?.admin.group).toBe("Integrations");
    expect(qb.collections.credentials?.admin.group).toBe("Integrations");
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
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
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
      fieldErrors: { "metadata.models": expect.stringMatching(/^0\.id: /) as unknown },
    });
    await expect(
      saveConnectionAction("/admin", null, "nope", idle, form({ name: "x" })),
    ).resolves.toMatchObject({ status: "error", message: 'Unknown provider type "nope"' });
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
      message: expect.stringMatching(/denied|not allowed/i) as unknown,
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
      message: expect.stringMatching(/used by 2 connection/) as unknown,
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
      title: "The connection works",
    });
    await expect(testConnectionAction("/admin", ids.claude!)).resolves.toMatchObject({
      ok: false,
      message: "Anthropic rejected the credential (HTTP 401).",
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
