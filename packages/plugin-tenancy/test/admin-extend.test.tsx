// @vitest-environment happy-dom
import { englishI18n } from "@quickben/admin/i18n";
import {
  defineCollection,
  defineConfig,
  definePlugin,
  devAuth,
  fields as f,
  getQuickben,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tenancy } from "../src";
import { tenancyAdmin } from "../src/admin";
import { updateMemberDetailsAction, updateOrganizationAction } from "../src/admin/actions";

import { actAs, incoming, navigation } from "./next-mocks";
import { alice, carol, staff, system } from "./setup";

import type { OrganizationSectionProps } from "../src/admin";
import type { AdminExtension, PageProps } from "@quickben/admin";
import type { AccessArgs } from "@quickben/core";
import type { ReactElement } from "react";

const isStaff = ({ user }: AccessArgs) => user?.roles?.includes("platform-admin") === true;

const regions = defineCollection({
  slug: "regions",
  fields: { name: f.text({ required: true }) },
  access: { read: () => true },
  admin: { useAsTitle: "name" },
});

const items = defineCollection({ slug: "items", fields: { name: f.text() } });

// A host adds fields to the tenancy collections. `plan` is only changed by platform staff.
const host = definePlugin({
  name: "host",
  addFields: {
    organizations: {
      plan: f.select({
        options: ["free", "pro"],
        label: "Plan",
        access: { create: isStaff, update: isStaff },
      }),
      taxId: f.text({ label: "Tax id", maxLength: 20 }),
      region: f.relation({ to: "regions", label: "Region" }),
      secret: f.text({ label: "Secret", admin: { hidden: true } }),
    },
    memberships: {
      title: f.text({ label: "Job title" }),
      seats: f.number({ label: "Seats", integer: true }),
      since: f.datetime({ label: "Since" }),
    },
  },
});

function BillingSection({ organization, tenant, segments }: Readonly<OrganizationSectionProps>) {
  return (
    <section>
      <h2>Billing of {organization.name}</h2>
      <p>Role: {tenant.role ?? "staff"}</p>
      <p>Rest: {segments.join("/")}</p>
    </section>
  );
}

function makeConfig() {
  return defineConfig({
    db: memoryAdapter(),
    collections: [regions, items],
    modules: [{ key: "sales", label: "Sales", collections: ["items"] }],
    plugins: [tenancy({ scope: ["items"] }), host],
    auth: devAuth(),
  });
}

let config: ReturnType<typeof makeConfig>;
let extension: AdminExtension;
let ids: Record<string, string>;

const pageProps: PageProps = {
  user: null,
  basePath: "/admin",
  segments: [],
  searchParams: {},
  i18n: englishI18n,
  serverFunction: () => Promise.resolve({ status: "options", options: [] }),
};

beforeEach(async () => {
  config = makeConfig();
  extension = tenancyAdmin(config, {
    sections: [
      { key: "billing", label: "Billing", component: BillingSection },
      {
        key: "audit",
        label: { en: "Audit" },
        component: () => <p>Audit log</p>,
        visible: (tenant) => tenant.platform,
      },
    ],
  });
  const qb = await getQuickben(config);
  const north = await qb.create("regions", { name: "North" }, system);
  const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, { user: alice });
  await qb.update("organizations", acme.id, { plan: "pro", region: north.id }, system);
  const carolAt = await qb.create(
    "memberships",
    {
      organization: acme.id,
      user: carol.id,
      email: carol.email,
      role: "member",
      status: "active",
      title: "Analyst",
    },
    system,
  );
  ids = { acme: acme.id, north: north.id, carol: carolAt.id };
});

afterEach(() => {
  cleanup();
  actAs(null);
  incoming.delete("x-quickben-organization");
});

async function renderPage(path: string, segments: string[] = []) {
  const page = extension.pages!.find((p) => p.path === path)!;
  const Page = page.component as unknown as (props: PageProps) => Promise<ReactElement>;
  return render(await Page({ ...pageProps, segments }));
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function run(action: (key: string, data: FormData) => Promise<void>, data: FormData) {
  await expect(action("/admin", data)).rejects.toThrow(/NEXT_REDIRECT/);
  return navigation.redirects.at(-1);
}

describe("added fields", () => {
  it("settings page renders them with field access", async () => {
    actAs(alice);
    await renderPage("organization");
    const plan = screen.getByRole<HTMLSelectElement>("combobox", { name: "Plan" });
    expect(plan.value).toBe("pro");
    expect(plan.disabled).toBe(true);
    const taxId = screen.getByRole<HTMLInputElement>("textbox", { name: "Tax id" });
    expect(taxId.disabled).toBe(false);
    expect(taxId.name).toBe("taxId");
    expect(screen.queryByLabelText("Secret")).toBeNull();
    // The relation input shows the label of the selected region.
    expect(document.body.textContent).toContain("North");
  });

  it("the settings action saves them; staff-only fields stay with staff", async () => {
    actAs(alice);
    expect(
      await run(updateOrganizationAction, form({ name: "Acme", taxId: "76-1", plan: "free" })),
    ).toBe("/admin/organization?toast=organization-saved");
    const qb = await getQuickben(config);
    expect(await qb.findById("organizations", ids.acme!, {}, system)).toMatchObject({
      taxId: "76-1",
      plan: "pro",
    });
    actAs(staff);
    incoming.set("x-quickben-organization", ids.acme!);
    await run(updateOrganizationAction, form({ name: "Acme", plan: "free", modules: "x" }));
    expect(navigation.redirects.at(-1)).toBe("/admin/organization?error=invalid");
    await run(updateOrganizationAction, form({ name: "Acme", plan: "free", status: "active" }));
    expect((await qb.findById("organizations", ids.acme!, {}, system)).plan).toBe("free");
  });

  it("the details dialog of a member renders and saves them", async () => {
    actAs(alice);
    await renderPage("members");
    const open = screen.getByRole("button", { name: "Details of carol@example.com" });
    expect(open.getAttribute("command")).toBe("show-modal");
    const dialog = document.getElementById(open.getAttribute("commandfor") ?? "")!;
    expect(dialog.tagName).toBe("DIALOG");
    const title = within(dialog).getByLabelText<HTMLInputElement>("Job title");
    expect(title.value).toBe("Analyst");
    // A closed dialog is hidden from the accessibility tree.
    expect(within(dialog).getByRole("button", { name: "Save details", hidden: true })).toBeTruthy();

    expect(
      await run(
        updateMemberDetailsAction,
        form({ membershipId: ids.carol!, title: "Lead", seats: "3" }),
      ),
    ).toBe("/admin/members?toast=member-updated");
    const qb = await getQuickben(config);
    expect(await qb.findById("memberships", ids.carol!, {}, system)).toMatchObject({
      title: "Lead",
      seats: 3,
    });
    const bad = await run(
      updateMemberDetailsAction,
      form({ membershipId: ids.carol!, seats: "1.5" }),
    );
    expect(bad).toBe("/admin/members?error=invalid");
  });

  it("members who cannot manage see the details read-only", async () => {
    actAs(carol);
    await renderPage("members");
    const open = screen.getByRole("button", { name: "Details of carol@example.com" });
    const dialog = document.getElementById(open.getAttribute("commandfor") ?? "")!;
    expect(within(dialog).queryByRole("button", { name: "Save details", hidden: true })).toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>("Job title").disabled).toBe(true);
  });
});

describe("review fixes", () => {
  it("dates of added fields are read in the time zone they were shown in", async () => {
    actAs(alice);
    await renderPage("members");
    expect(document.querySelector<HTMLInputElement>('input[name="qb-time-zone"]')?.value).toBe(
      "UTC",
    );
    const save = (zone: string) =>
      run(
        updateMemberDetailsAction,
        form({ membershipId: ids.carol!, since: "2026-01-15T09:00", "qb-time-zone": zone }),
      );
    const qb = await getQuickben(config);
    await save("America/Santiago");
    expect((await qb.findById("memberships", ids.carol!, {}, system)).since).toBe(
      "2026-01-15T12:00:00.000Z",
    );
    await save("Not/AZone");
    expect((await qb.findById("memberships", ids.carol!, {}, system)).since).toBe(
      "2026-01-15T09:00:00.000Z",
    );
  });

  it("expired modules stay ticked in the members table", async () => {
    const qb = await getQuickben(config);
    await qb.update(
      "organizations",
      ids.acme!,
      { modules: [{ key: "sales", expiresAt: "2020-01-01T00:00:00Z" }] },
      system,
    );
    await qb.update("memberships", ids.carol!, { modules: ["sales"] }, system);
    actAs(alice);
    await renderPage("members");
    const row = screen.getByRole("row", { name: /carol@example.com/ });
    const box = within(row).getByRole<HTMLInputElement>("checkbox", { name: "Sales (expired)" });
    expect(box.checked).toBe(true);
  });
});

describe("settings sections", () => {
  it("shows tabs and renders a section with the tenant", async () => {
    actAs(alice);
    await renderPage("organization");
    const tabs = screen.getByRole("navigation", { name: "Settings sections" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["General", "/admin/organization"],
      ["Billing", "/admin/organization/billing"],
    ]);
    expect(within(tabs).getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe(
      "page",
    );
    cleanup();
    await renderPage("organization", ["billing", "invoices"]);
    expect(screen.getByRole("heading", { name: "Billing of Acme" })).toBeTruthy();
    expect(screen.getByText("Role: owner")).toBeTruthy();
    expect(screen.getByText("Rest: invoices")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create organization" })).toBeNull();
  });

  it("hides sections by visibility and answers unknown ones", async () => {
    actAs(alice);
    await renderPage("organization", ["audit"]);
    expect(screen.getByText("That settings section does not exist.")).toBeTruthy();
    cleanup();
    actAs(staff);
    incoming.set("x-quickben-organization", ids.acme!);
    await renderPage("organization", ["audit"]);
    expect(screen.getByText("Audit log")).toBeTruthy();
  });

  it("checks section keys", () => {
    const section = { key: "Bad key", label: "x", component: () => null };
    expect(() => tenancyAdmin(config, { sections: [section] })).toThrow(/Invalid/);
    const ok = { ...section, key: "ok" };
    expect(() => tenancyAdmin(config, { sections: [ok, ok] })).toThrow(/twice/);
  });
});
