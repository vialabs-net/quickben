// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { createAdminI18n, englishI18n } from "@quickben/admin/i18n";
import { defineConfig, devAuth, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tenancy } from "../src";
import { createOrganizationSwitcher, tenancyAdmin } from "../src/admin";
import {
  createOrganizationAction,
  inviteMemberAction,
  removeMemberAction,
  switchOrganizationAction,
  updateMemberAction,
  updateOrganizationAction,
} from "../src/admin/actions";

import { actAs, incoming, jar, navigation } from "./next-mocks";
import { alice, bob, carol, dave, notes, posts, reports, staff, system } from "./setup";

import type { AdminExtension, AdminI18n, AdminText, PageProps } from "@quickben/admin";
import type { QuickbenUser } from "@quickben/core";
import type { ReactElement } from "react";

function makeAdminConfig(locale?: string) {
  return defineConfig({
    ...(locale === undefined ? {} : { admin: { locale } }),
    db: memoryAdapter(),
    collections: [posts, notes, reports],
    modules: [
      { key: "sales", label: "Sales", collections: ["posts"] },
      { key: "reports", label: "Reports", collections: ["reports"] },
    ],
    plugins: [tenancy({ scope: ["posts", "notes"] })],
    auth: devAuth(),
  });
}

let config: ReturnType<typeof makeAdminConfig>;
let extension: AdminExtension;
let ids: Record<string, string>;

beforeEach(async () => {
  config = makeAdminConfig();
  extension = tenancyAdmin(config, { basePath: "/admin/" });
  const qb = await getQuickben(config);
  const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, { user: alice });
  const globex = await qb.create(
    "organizations",
    { name: "Globex", slug: "globex" },
    { user: bob },
  );
  const add = (user: QuickbenUser, role: string) =>
    qb.create(
      "memberships",
      { organization: acme.id, user: user.id, email: user.email ?? null, role, status: "active" },
      system,
    );
  ids = {
    acme: acme.id,
    globex: globex.id,
    bob: (await add(bob, "admin")).id,
    carol: (await add(carol, "member")).id,
    dave: (await add(dave, "viewer")).id,
  };
  ids.alice = (
    await qb.find("memberships", { where: { user: { eq: "alice" } } }, system)
  ).docs[0]!.id;
});

afterEach(() => {
  cleanup();
  actAs(null);
  incoming.delete("x-quickben-organization");
});

/**
 * Pick the active organization for the next render. happy-dom drops `cookie` request headers,
 * so tests send the tenancy header; the cookie path is covered by the plugin tests.
 */
function selectOrg(id: string) {
  incoming.set("x-quickben-organization", id);
}

const pageProps: PageProps = {
  user: null,
  basePath: "/admin",
  segments: [],
  searchParams: {},
  i18n: englishI18n,
  serverFunction: () => Promise.resolve({ status: "options", options: [] }),
};

const spanish = createAdminI18n({ locale: "es", timeZone: "UTC", overrides: {} });

type Switcher = (props: { i18n?: AdminI18n }) => Promise<ReactElement | null>;

async function renderSidebar(i18n: AdminI18n = englishI18n) {
  const Sidebar = extension.sidebar![0]! as unknown as Switcher;
  const element = await Sidebar({ i18n });
  return element ? render(element) : null;
}

async function renderPage(
  path: string,
  searchParams: PageProps["searchParams"] = {},
  i18n: AdminI18n = englishI18n,
) {
  const page = extension.pages!.find((p) => p.path === path)!;
  const Page = page.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ ...pageProps, searchParams, i18n }));
}

function label(value: AdminText | undefined, i18n: AdminI18n = englishI18n): string | undefined {
  return typeof value === "function" ? value(i18n) : i18n.text(value);
}

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function run(action: (key: string, data: FormData) => Promise<void>, data: FormData) {
  await expect(action("/admin", data)).rejects.toThrow(/NEXT_REDIRECT/);
  return navigation.redirects.at(-1);
}

describe("tenancyAdmin", () => {
  it("adds a sidebar switcher and two pages", () => {
    expect(extension.sidebar).toHaveLength(1);
    expect(extension.pages?.map((p) => [p.path, label(p.label), label(p.group)])).toEqual([
      ["members", "Members", "Organization"],
      ["organization", "Organization settings", "Organization"],
    ]);
    expect(extension.pages?.map((p) => label(p.label, spanish))).toEqual([
      "Miembros",
      "Ajustes de la organización",
    ]);
    expect(extension.catalogs?.map((bundle) => bundle.namespace)).toEqual(["tenancy"]);
    expect(tenancyAdmin(config, { basePath: "x", group: "Team" }).pages?.[0]?.group).toBe("Team");
  });

  it("switcher: shows the user's organizations and the active one", async () => {
    actAs(bob);
    await renderSidebar();
    const select = screen.getByRole("combobox", { name: "Active organization" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Choose…", "Acme (Admin)", "Globex (Owner)"]);
    cleanup();
    selectOrg(ids.globex!);
    await renderSidebar();
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(ids.globex);
  });

  it("switcher: platform staff pick any organization or all", async () => {
    actAs(staff);
    await renderSidebar();
    const options = within(screen.getByRole("combobox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All organizations", "Acme", "Globex"]);
    cleanup();
    selectOrg(ids.acme!);
    await renderSidebar();
    expect(within(screen.getByRole("combobox")).getAllByRole("option")[0]?.textContent).toBe(
      "All organizations",
    );
  });

  it("switcher: nothing for anonymous users, a link without organizations", async () => {
    actAs(null);
    expect(await renderSidebar()).toBeNull();
    actAs({ id: "nobody" });
    await renderSidebar();
    expect(screen.getByRole("link", { name: "Create one" }).getAttribute("href")).toBe(
      "/admin/organization",
    );
  });

  it("switch action sets the cookie after checking the membership", async () => {
    actAs(bob);
    expect(await run(switchOrganizationAction, form({ organizationId: ids.globex! }))).toBe(
      "/admin",
    );
    expect(jar.get("quickben-organization")).toBe(ids.globex);
    expect(navigation.revalidated).toEqual(["/admin"]);
    actAs(carol);
    const denied = await run(switchOrganizationAction, form({ organizationId: ids.globex! }));
    expect(denied).toBe("/admin/organization?error=organization-not-member");
    expect(jar.has("quickben-organization")).toBe(false);
    jar.set("quickben-organization", ids.acme!);
    await run(switchOrganizationAction, form({ organizationId: "" }));
    expect(jar.has("quickben-organization")).toBe(false);
  });

  it("members page: managers get forms, viewers get badges", async () => {
    actAs(alice);
    await renderPage("members", { toast: "member-updated" });
    expect(screen.getByRole("heading", { level: 1, name: "Members" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Role of carol@example.com" })).toBeTruthy();
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Role of alice@example.com" })
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Remove dave@example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Member updated");
    cleanup();
    actAs(dave);
    await renderPage("members", { error: "forbidden" });
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Viewer")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("You are not allowed to do that.");
  });

  it("feedback shows fixed messages for known codes only", async () => {
    actAs(alice);
    await renderPage("members", { error: "<b>Pay here</b>", toast: "Click evil.example" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain("evil.example");
    cleanup();
    await renderPage("members", { error: ["last-owner", "x"] });
    expect(screen.getByRole("alert").textContent).toContain("at least one active owner");
    cleanup();
    await renderPage("members", { error: "toString" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("members page: asks to choose or sign in when there is no organization", async () => {
    actAs(bob);
    await renderPage("members");
    expect(screen.getByText(/Choose an organization in the sidebar/)).toBeTruthy();
    cleanup();
    actAs({ id: "nobody" });
    await renderPage("members");
    expect(screen.getByText(/Create one or ask to be invited/)).toBeTruthy();
    cleanup();
    actAs(null);
    await renderPage("members");
    expect(screen.getByText("Sign in to manage an organization.")).toBeTruthy();
  });

  it("member actions go through the guard rails", async () => {
    actAs(alice);
    expect(
      await run(inviteMemberAction, form({ invitee: "eve@example.com", role: "viewer" })),
    ).toBe("/admin/members?toast=invited");
    expect(await run(inviteMemberAction, form({ invitee: "frank" }))).toBe(
      "/admin/members?toast=invited",
    );
    expect(await run(inviteMemberAction, form({ invitee: "frank" }))).toBe(
      "/admin/members?error=already-member",
    );
    const qb = await getQuickben(config);
    const invited = await qb.find("memberships", { where: { status: { eq: "invited" } } }, system);
    expect(invited.docs.map((m) => [m.email, m.user, m.role])).toEqual(
      expect.arrayContaining([
        ["eve@example.com", null, "viewer"],
        [null, "frank", "member"],
      ]),
    );
    expect(
      await run(
        updateMemberAction,
        form({ membershipId: ids.carol!, role: "admin", status: "active", modules: ["sales"] }),
      ),
    ).toBe("/admin/members?toast=member-updated");
    const carolNow = await qb.findById("memberships", ids.carol!, {}, system);
    expect(carolNow).toMatchObject({ role: "admin", modules: ["sales"] });
    const own = await run(updateMemberAction, form({ membershipId: ids.alice!, role: "member" }));
    expect(own).toBe("/admin/members?error=own-role");
    actAs(staff);
    selectOrg(ids.acme!);
    const last = await run(updateMemberAction, form({ membershipId: ids.alice!, role: "member" }));
    expect(last).toBe("/admin/members?error=last-owner");
    actAs(alice);
    expect(await run(removeMemberAction, form({ membershipId: ids.dave! }))).toBe(
      "/admin/members?toast=member-removed",
    );
    const self = await run(removeMemberAction, form({ membershipId: ids.alice! }));
    expect(self).toBe("/admin/members?error=own-membership");
  });

  it("organization page: managers rename, platform staff set status and modules", async () => {
    actAs(alice);
    await renderPage("organization");
    expect((document.getElementById("qb-org-name") as HTMLInputElement).value).toBe("Acme");
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.getByText("Set by platform staff.")).toBeTruthy();
    expect(await run(updateOrganizationAction, form({ name: "Acme Inc" }))).toBe(
      "/admin/organization?toast=organization-saved",
    );
    cleanup();
    actAs(carol);
    await renderPage("organization");
    expect(screen.getByText("Your role cannot change these settings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    const denied = await run(updateOrganizationAction, form({ name: "X" }));
    expect(denied).toBe("/admin/organization?error=forbidden");
    cleanup();
    actAs(staff);
    selectOrg(ids.acme!);
    await renderPage("organization");
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    await run(
      updateOrganizationAction,
      form({ name: "Acme", status: "suspended", modules: ["reports"] }),
    );
    const qb = await getQuickben(config);
    expect(await qb.findById("organizations", ids.acme!, {}, system)).toMatchObject({
      name: "Acme",
      status: "suspended",
      modules: ["reports"],
    });
    cleanup();
    incoming.delete("x-quickben-organization");
    actAs(staff);
    await renderPage("organization");
    expect(screen.getByText("Choose an organization in the sidebar.")).toBeTruthy();
  });

  it("create organization action makes it active", async () => {
    actAs({ id: "nobody", email: "nobody@example.com" });
    expect(await run(createOrganizationAction, form({ name: "New", slug: "new-org" }))).toBe(
      "/admin/organization?toast=organization-created",
    );
    const qb = await getQuickben(config);
    const created = (await qb.find("organizations", { where: { slug: { eq: "new-org" } } }, system))
      .docs[0]!;
    expect(jar.get("quickben-organization")).toBe(created.id);
    const bad = await run(createOrganizationAction, form({ name: "Bad", slug: "Not ok" }));
    expect(bad).toBe("/admin/organization?error=invalid-slug");
    expect(await run(createOrganizationAction, form({ name: "Again", slug: "new-org" }))).toBe(
      "/admin/organization?error=slug-taken",
    );
  });

  it("actions reject unknown keys", async () => {
    await expect(switchOrganizationAction("/nope", form({}))).rejects.toThrow(/not ready/);
    await expect(switchOrganizationAction(1 as unknown as string, form({}))).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("tenancy admin in Spanish", () => {
  it("renders the pages and the switcher in the request locale", async () => {
    actAs(alice);
    await renderPage("members", { toast: "invited" }, spanish);
    expect(screen.getByRole("heading", { level: 1, name: "Miembros" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Rol" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Rol de carol@example.com" })).toBeTruthy();
    expect(screen.getByText("(tú)")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Invitación creada");
    cleanup();
    await renderPage("organization", { error: "slug-taken" }, spanish);
    expect(screen.getByRole("button", { name: "Crear organización" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Otra organización ya usa ese slug.");
    cleanup();
    actAs(bob);
    await renderPage("members", {}, spanish);
    expect(screen.getByText(/Perteneces a varias organizaciones/)).toBeTruthy();
    cleanup();
    await renderSidebar(spanish);
    expect(
      within(screen.getByRole("combobox", { name: "Organización activa" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Elige…", "Acme (Administrador)", "Globex (Propietario)"]);
  });

  it("uses overrides from admin.messages", async () => {
    actAs(alice);
    const i18n = createAdminI18n({
      locale: "en",
      timeZone: "UTC",
      overrides: { "tenancy.members.title": "Team" },
    });
    await renderPage("members", {}, i18n);
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeTruthy();
  });
});

describe("createOrganizationSwitcher", () => {
  it("renders outside the admin and resolves the locale from the config", async () => {
    const esConfig = makeAdminConfig("es");
    const Switcher = createOrganizationSwitcher(esConfig, {
      basePath: "/app/admin/",
    }) as unknown as Switcher;
    actAs({ id: "nobody" });
    render(await Switcher({}));
    expect(screen.getByRole("link", { name: "Crear una" }).getAttribute("href")).toBe(
      "/app/admin/organization",
    );
    cleanup();
    render(await Switcher({ i18n: englishI18n }));
    expect(screen.getByRole("link", { name: "Create one" })).toBeTruthy();
    actAs(null);
    expect(await Switcher({})).toBeNull();
  });

  it("registers the instance so the switch action works", async () => {
    const other = makeAdminConfig();
    createOrganizationSwitcher(other, { basePath: "/embedded" });
    const qb = await getQuickben(other);
    const org = await qb.create(
      "organizations",
      { name: "Initech", slug: "initech" },
      { user: bob },
    );
    actAs(bob);
    await expect(
      switchOrganizationAction("/embedded", form({ organizationId: org.id })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(navigation.redirects.at(-1)).toBe("/embedded");
    expect(jar.get("quickben-organization")).toBe(org.id);
    const Switcher = createOrganizationSwitcher(other) as unknown as Switcher;
    expect(await Switcher({ i18n: englishI18n })).not.toBeNull();
  });
});

describe("styles", () => {
  it("uses only classes that exist in @quickben/admin/styles.css", async () => {
    const require = createRequire(import.meta.url);
    const adminDir = dirname(require.resolve("@quickben/admin/package.json"));
    const css = await readFile(join(adminDir, "dist/styles.css"), "utf8");
    const sources = [
      "shared.tsx",
      "switcher.tsx",
      "members.tsx",
      "organization.tsx",
      "auto-submit.tsx",
    ];
    const missing: string[] = [];
    for (const file of sources) {
      const source = await readFile(join(import.meta.dirname, "../src/admin", file), "utf8");
      for (const [cls] of source.matchAll(/qb:[\w:./[\]-]+/g)) {
        const escaped = `.${cls.replaceAll(/[:./[\]]/g, (c) => "\\" + c)}`;
        if (!css.includes(escaped)) missing.push(`${file}: ${cls}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
