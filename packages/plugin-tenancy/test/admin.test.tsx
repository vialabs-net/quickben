// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { defineConfig, devAuth } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { getQuickben } from "@quickben/next";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tenancy } from "../src";
import { tenancyAdmin } from "../src/admin";
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

import type { AdminExtension, PageProps } from "@quickben/admin";
import type { QuickbenUser } from "@quickben/core";
import type { ReactElement } from "react";

function makeAdminConfig() {
  return defineConfig({
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

const pageProps: PageProps = { user: null, basePath: "/admin", segments: [], searchParams: {} };

async function renderSidebar() {
  const Sidebar = extension.sidebar![0]! as unknown as () => Promise<ReactElement | null>;
  const element = await Sidebar();
  return element ? render(element) : null;
}

async function renderPage(path: string, searchParams: PageProps["searchParams"] = {}) {
  const page = extension.pages!.find((p) => p.path === path)!;
  const Page = page.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ ...pageProps, searchParams }));
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
    expect(extension.pages?.map((p) => [p.path, p.label, p.group])).toEqual([
      ["members", "Members", "Organization"],
      ["organization", "Settings", "Organization"],
    ]);
    expect(tenancyAdmin(config, { basePath: "x", group: "Team" }).pages?.[0]?.group).toBe("Team");
  });

  it("switcher: shows the user's organizations and the active one", async () => {
    actAs(bob);
    await renderSidebar();
    const select = screen.getByRole("combobox", { name: "Organization" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Choose…", "Acme (admin)", "Globex (owner)"]);
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
      "/admin?toast=Organization%20switched",
    );
    expect(jar.get("quickben-organization")).toBe(ids.globex);
    expect(navigation.revalidated).toEqual(["/admin"]);
    actAs(carol);
    const denied = await run(switchOrganizationAction, form({ organizationId: ids.globex! }));
    expect(denied).toMatch(/^\/admin\?error=You%20are%20not%20a%20member/);
    expect(jar.has("quickben-organization")).toBe(false);
    jar.set("quickben-organization", ids.acme!);
    await run(switchOrganizationAction, form({ organizationId: "" }));
    expect(jar.has("quickben-organization")).toBe(false);
  });

  it("members page: managers get forms, viewers get badges", async () => {
    actAs(alice);
    await renderPage("members", { toast: "Member updated" });
    expect(screen.getByRole("heading", { level: 1, name: "Members" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Role of carol@example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove dave@example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Member updated");
    cleanup();
    actAs(dave);
    await renderPage("members", { error: "Nope" });
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert").textContent).toContain("Nope");
  });

  it("members page: asks to choose or sign in when there is no organization", async () => {
    actAs(bob);
    await renderPage("members");
    expect(screen.getByText(/Choose an organization in the sidebar/)).toBeTruthy();
    cleanup();
    actAs({ id: "nobody" });
    await renderPage("members");
    expect(screen.getByText(/Create an organization or ask to be invited/)).toBeTruthy();
    cleanup();
    actAs(null);
    await renderPage("members");
    expect(screen.getByText("Sign in to manage an organization.")).toBeTruthy();
  });

  it("member actions go through the guard rails", async () => {
    actAs(alice);
    expect(
      await run(inviteMemberAction, form({ invitee: "eve@example.com", role: "viewer" })),
    ).toBe("/admin/members?toast=Invitation%20created");
    expect(await run(inviteMemberAction, form({ invitee: "frank" }))).toMatch(/toast=/);
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
    ).toBe("/admin/members?toast=Member%20updated");
    const carolNow = await qb.findById("memberships", ids.carol!, system);
    expect(carolNow).toMatchObject({ role: "admin", modules: ["sales"] });
    const own = await run(updateMemberAction, form({ membershipId: ids.alice!, role: "member" }));
    expect(decodeURIComponent(own ?? "")).toContain("your own role");
    actAs(staff);
    selectOrg(ids.acme!);
    const last = await run(updateMemberAction, form({ membershipId: ids.alice!, role: "member" }));
    expect(decodeURIComponent(last ?? "")).toContain("at least one active owner");
    actAs(alice);
    expect(await run(removeMemberAction, form({ membershipId: ids.dave! }))).toBe(
      "/admin/members?toast=Member%20removed",
    );
    const self = await run(removeMemberAction, form({ membershipId: ids.alice! }));
    expect(decodeURIComponent(self ?? "")).toContain("your own owner");
  });

  it("organization page: managers rename, platform staff set status and modules", async () => {
    actAs(alice);
    await renderPage("organization");
    expect((document.getElementById("qb-org-name") as HTMLInputElement).value).toBe("Acme");
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.getByText("Set by platform staff.")).toBeTruthy();
    expect(await run(updateOrganizationAction, form({ name: "Acme Inc" }))).toBe(
      "/admin/organization?toast=Organization%20saved",
    );
    cleanup();
    actAs(carol);
    await renderPage("organization");
    expect(screen.getByText("Your role cannot change these settings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    const denied = await run(updateOrganizationAction, form({ name: "X" }));
    expect(denied).toMatch(/error=/);
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
    expect(await qb.findById("organizations", ids.acme!, system)).toMatchObject({
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
      "/admin/organization?toast=Organization%20created",
    );
    const qb = await getQuickben(config);
    const created = (await qb.find("organizations", { where: { slug: { eq: "new-org" } } }, system))
      .docs[0]!;
    expect(jar.get("quickben-organization")).toBe(created.id);
    const bad = await run(createOrganizationAction, form({ name: "Bad", slug: "Not ok" }));
    expect(bad).toMatch(/error=/);
  });

  it("actions reject unknown keys", async () => {
    await expect(switchOrganizationAction("/nope", form({}))).rejects.toThrow(/not ready/);
    await expect(switchOrganizationAction(1 as unknown as string, form({}))).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("styles", () => {
  it("uses only classes that exist in @quickben/admin/styles.css", async () => {
    const require = createRequire(import.meta.url);
    const adminDir = dirname(require.resolve("@quickben/admin/package.json"));
    const css = await readFile(join(adminDir, "dist/styles.css"), "utf8");
    const sources = ["shared.tsx", "switcher.tsx", "members.tsx", "organization.tsx"];
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
