// @vitest-environment happy-dom
import { englishI18n } from "@quickben/admin/i18n";
import { defineConfig, devAuth, fields as f, definePlugin, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberHookError, tenancy } from "../src";
import { createOrganizationSwitcher, tenancyAdmin } from "../src/admin";
import {
  inviteMemberAction,
  switchOrganizationAction,
  updateMemberAction,
  updateMemberDetailsAction,
} from "../src/admin/actions";
import { NOTICE_COOKIE } from "../src/admin/feedback";

import { actAs, incoming, jar, navigation } from "./next-mocks";
import { alice, bob, carol, dave, notes, posts, reports, system } from "./setup";

import type { MemberEvent, TenancyOptions } from "../src";
import type { PageProps } from "@quickben/admin";
import type { QuickbenUser } from "@quickben/core";
import type { ReactElement } from "react";

const branches: Record<string, string> = { bob: "north", carol: "north", dave: "south" };

async function build(basePath: string, options: Partial<TenancyOptions<"posts" | "notes">> = {}) {
  const config = defineConfig({
    db: memoryAdapter(),
    collections: [posts, notes, reports],
    modules: [
      { key: "sales", label: "Sales", collections: ["posts"] },
      { key: "reports", label: "Reports", collections: ["reports"] },
    ],
    plugins: [
      tenancy({ scope: ["posts", "notes"], ...options }),
      definePlugin({
        name: "member-fields",
        addFields: {
          memberships: {
            title: f.text({ maxLength: 50 }),
            // Hidden from users; hooks still get it.
            hostRef: f.text({ access: { read: () => false } }),
          },
        },
      }),
    ],
    auth: devAuth(),
  });
  const extension = tenancyAdmin(config, {
    basePath,
    organizationHref: (id) => `/settings/t/${id}/members`,
  });
  const qb = await getQuickben(config);
  const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, { user: alice });
  const add = (user: QuickbenUser, role: string) =>
    qb.create(
      "memberships",
      { organization: acme.id, user: user.id, email: user.email ?? null, role, status: "active" },
      system,
    );
  const ids = {
    acme: acme.id,
    bob: (await add(bob, "admin")).id,
    carol: (await add(carol, "member")).id,
    dave: (await add(dave, "viewer")).id,
  };
  incoming.set("x-quickben-organization", acme.id);
  const renderPage = async (searchParams: PageProps["searchParams"] = {}) => {
    const page = extension.pages!.find((p) => p.path === "members")!;
    const Page = page.component as unknown as (props: PageProps) => Promise<ReactElement>;
    const props: PageProps = {
      user: null,
      basePath,
      segments: [],
      searchParams,
      i18n: englishI18n,
      serverFunction: () => Promise.resolve({ status: "options", options: [] }),
    };
    return render(await Page(props));
  };
  return { qb, ids, renderPage, config };
}

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function run(
  action: (key: string, data: FormData) => Promise<void>,
  key: string,
  data: FormData,
) {
  await expect(action(key, data)).rejects.toThrow(/NEXT_REDIRECT/);
  return navigation.redirects.at(-1);
}

afterEach(() => {
  cleanup();
  actAs(null);
  incoming.delete("x-quickben-organization");
});

describe("tenancy admin with member hooks", () => {
  it("shows the hook's message when it stops a change", async () => {
    const onInvite = vi.fn(({ after }: MemberEvent) => {
      if (after?.email?.endsWith("@blocked.example")) {
        throw new MemberHookError("The host does not allow that domain.");
      }
    });
    const onUpdate = vi.fn();
    const { ids, renderPage } = await build("/hooks", { memberHooks: { onInvite, onUpdate } });
    actAs(alice);
    incoming.set("x-quickben-organization", ids.acme);
    expect(await run(inviteMemberAction, "/hooks", form({ invitee: "x@blocked.example" }))).toBe(
      "/hooks/members?error=hook",
    );
    expect(jar.get(NOTICE_COOKIE)).toBe("The host does not allow that domain.");
    await renderPage({ error: "hook" });
    expect(screen.getByRole("alert").textContent).toContain("The host does not allow that domain.");
    cleanup();
    // Without the cookie, the fixed message.
    jar.delete(NOTICE_COOKIE);
    await renderPage({ error: "hook" });
    expect(screen.getByRole("alert").textContent).toContain("The change was stopped.");
    expect(await run(inviteMemberAction, "/hooks", form({ invitee: "ok@example.com" }))).toBe(
      "/hooks/members?toast=invited",
    );
    expect(onInvite).toHaveBeenCalledTimes(2);
  });

  it("runs onUpdate for the member details dialog", async () => {
    const onUpdate = vi.fn();
    const { ids, qb } = await build("/details", { memberHooks: { onUpdate } });
    await qb.update("memberships", ids.carol, { hostRef: "crm-42" }, system);
    actAs(alice);
    incoming.set("x-quickben-organization", ids.acme);
    expect(
      await run(
        updateMemberDetailsAction,
        "/details",
        form({ membershipId: ids.carol, title: "Sales lead" }),
      ),
    ).toBe("/details/members?toast=member-updated");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [event] = onUpdate.mock.calls[0] as [MemberEvent];
    expect([event.before?.title, event.after?.title]).toEqual([null, "Sales lead"]);
    // Events carry stored records, also fields the user cannot read.
    expect([event.before?.hostRef, event.after?.hostRef]).toEqual(["crm-42", "crm-42"]);
  });
});

describe("tenancy admin with emptyModules none", () => {
  it('offers "All modules" and stores it as "*"', async () => {
    const { qb, ids, renderPage } = await build("/none", { emptyModules: "none" });
    actAs(alice);
    incoming.set("x-quickben-organization", ids.acme);
    await renderPage();
    expect(screen.getByText(/Tick "All modules" to grant every module/)).toBeTruthy();
    const boxes = screen.getAllByRole<HTMLInputElement>("checkbox", { name: "All modules" });
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true, true]);
    await run(
      updateMemberAction,
      "/none",
      form({ membershipId: ids.carol, role: "member", status: "active" }),
    );
    expect((await qb.findById("memberships", ids.carol, {}, system)).modules).toEqual([]);
    cleanup();
    actAs(dave);
    await renderPage();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getAllByText("All")).toHaveLength(3);
    actAs(alice);
    await run(
      updateMemberAction,
      "/none",
      form({ membershipId: ids.carol, role: "member", status: "active", modules: ["*", "sales"] }),
    );
    expect((await qb.findById("memberships", ids.carol, {}, system)).modules).toEqual(["*"]);
  });
});

describe("tenancy admin with canManageMember", () => {
  it("shows forms only for members the user may manage", async () => {
    const { ids, renderPage } = await build("/scoped", {
      canManageMember: ({ allowedByRank, actor, target }) => {
        const branch = branches[actor.id];
        return allowedByRank && (branch === undefined || branch === branches[target.user ?? ""]);
      },
    });
    actAs(bob);
    incoming.set("x-quickben-organization", ids.acme);
    await renderPage();
    expect(screen.getByRole("combobox", { name: "Role of carol@example.com" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Role of dave@example.com" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove alice@example.com" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    // Every row keeps one cell per column.
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.children.length);
    expect(new Set(cells).size).toBe(1);
    expect(
      await run(
        updateMemberAction,
        "/scoped",
        form({ membershipId: ids.dave, role: "member", status: "active" }),
      ),
    ).toBe("/scoped/members?error=cannot-manage");
  });
});

describe("tenancy admin with separate update and remove rules", () => {
  it("shows Save and Remove by their own answer", async () => {
    const { ids, renderPage } = await build("/split", {
      // Admins may remove viewers but not change them.
      canManageMember: ({ allowedByRank, action, target }) =>
        allowedByRank && !(action === "update" && target.role === "viewer"),
    });
    actAs(bob);
    incoming.set("x-quickben-organization", ids.acme);
    await renderPage();
    expect(screen.queryByRole("combobox", { name: "Role of dave@example.com" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove dave@example.com" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Role of carol@example.com" })).toBeTruthy();
  });
});

describe("organizationHref", () => {
  it("sends the switcher to the host URL of the organization", async () => {
    const { ids, config } = await build("/hosted");
    // A switcher registered later without the option keeps the link.
    createOrganizationSwitcher(config, { basePath: "/hosted" });
    actAs(alice);
    expect(await run(switchOrganizationAction, "/hosted", form({ organizationId: ids.acme }))).toBe(
      `/settings/t/${ids.acme}/members`,
    );
    expect(await run(switchOrganizationAction, "/hosted", form({ organizationId: "" }))).toBe(
      "/hosted",
    );
    expect(await run(switchOrganizationAction, "/hosted", form({ organizationId: "nope" }))).toBe(
      "/hosted/organization?error=organization-not-member",
    );
  });
});
