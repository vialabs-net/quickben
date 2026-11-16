import { ConfigError, createQuickben, ForbiddenError, ValidationError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import {
  acceptInvitation,
  ALL_MODULES,
  canManageMember,
  guardsSkipped,
  inviteMember,
  MemberHookError,
  migrateEmptyModules,
  organizationFromPath,
  removeMember,
  resolveTenant,
  TenancyRuleError,
  updateMembership,
} from "../src";

import { alice, as, bob, carol, dave, inOrg, makeConfig, setup, staff, system } from "./setup";

import type { MemberEvent, MemberHooks } from "../src";
import type { QuickbenUser } from "@quickben/core";

const eve: QuickbenUser = { id: "eve", email: "eve@example.com" };

describe("emptyModules", () => {
  it("keeps today's meaning by default: an empty list grants every module", async () => {
    const { qb, acme, carolAtAcme } = await setup();
    expect(carolAtAcme.modules).toEqual([]);
    expect((await resolveTenant(qb, inOrg(carol, acme.id))).modules).toEqual(["sales", "reports"]);
    await updateMembership(qb, as(alice), carolAtAcme.id, { modules: "all" });
    const tenant = await resolveTenant(qb, inOrg(carol, acme.id));
    expect(tenant.membership?.modules).toEqual([ALL_MODULES]);
    expect(tenant.modules).toEqual(["sales", "reports"]);
  });

  it('"none": an empty list grants no module, "*" grants all, new members get all', async () => {
    const { qb, acme, carolAtAcme } = await setup({ emptyModules: "none" });
    expect(carolAtAcme.modules).toEqual([ALL_MODULES]);
    expect((await resolveTenant(qb, inOrg(carol, acme.id))).modules).toEqual(["sales", "reports"]);
    await updateMembership(qb, as(alice), carolAtAcme.id, { modules: [] });
    expect((await resolveTenant(qb, inOrg(carol, acme.id))).modules).toEqual([]);
    // No module: scoped collections of a module are closed, the others stay open.
    await expect(qb.find("posts", {}, inOrg(carol, acme.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await qb.find("notes", {}, inOrg(carol, acme.id))).docs).toEqual([]);
    await updateMembership(qb, as(alice), carolAtAcme.id, { modules: ["sales"] });
    expect((await resolveTenant(qb, inOrg(carol, acme.id))).modules).toEqual(["sales"]);
    const invited = await inviteMember(qb, as(alice), {
      organizationId: acme.id,
      email: "x@example.com",
    });
    expect(invited.modules).toEqual([ALL_MODULES]);
    const none = await inviteMember(qb, as(alice), {
      organizationId: acme.id,
      email: "n@example.com",
      modules: [],
    });
    expect(none.modules).toEqual([]);
  });

  it('rejects "*" mixed with keys and a bad option', async () => {
    const { qb, carolAtAcme } = await setup();
    await expect(
      updateMembership(qb, as(alice), carolAtAcme.id, { modules: [ALL_MODULES, "sales"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(() => makeConfig({ emptyModules: "some" as "all" })).toThrow(ConfigError);
  });

  it("migrateEmptyModules gives empty lists every module before a switch", async () => {
    const config = makeConfig();
    const qb = await createQuickben(config);
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    await qb.create(
      "memberships",
      { organization: acme.id, user: "carol", role: "member", status: "active" },
      system,
    );
    await qb.create(
      "memberships",
      { organization: acme.id, user: "dave", status: "active", modules: ["sales"] },
      system,
    );
    expect(await migrateEmptyModules(qb)).toBe(2);
    const rows = await qb.find("memberships", { sort: "user" }, system);
    expect(rows.docs.map((doc) => [doc.user, doc.modules])).toEqual([
      ["alice", [ALL_MODULES]],
      ["carol", [ALL_MODULES]],
      ["dave", ["sales"]],
    ]);
    expect(await migrateEmptyModules(qb)).toBe(0);
  });
});

describe("guardsSkipped", () => {
  it("requires explicit overrideAccess and lets skipGuards retain the last-owner rule", () => {
    expect(guardsSkipped({ user: null })).toBe(false);
    expect(guardsSkipped(system)).toBe(true);
    expect(guardsSkipped({ ...system, skipGuards: false })).toBe(false);
    expect(guardsSkipped({ ...system, skipGuards: true })).toBe(true);
    expect(guardsSkipped({ user: alice, skipGuards: true })).toBe(false);
    expect(guardsSkipped({ user: null, skipGuards: true })).toBe(false);
    expect(guardsSkipped({ user: alice, overrideAccess: false, skipGuards: true })).toBe(false);
  });
});

describe("memberHooks", () => {
  function recorder() {
    const events: { name: string; before: unknown; after: unknown; action: string }[] = [];
    const hook =
      (name: string) =>
      ({ action, before, after }: MemberEvent) => {
        events.push({
          name,
          action,
          before: before ? [before.role, before.status] : null,
          after: after ? [after.role, after.status] : null,
        });
      };
    const hooks: MemberHooks = {
      onInvite: hook("invite"),
      onAccept: hook("accept"),
      onRoleChange: hook("role"),
      onStatusChange: hook("status"),
      onUpdate: hook("update"),
      onRemove: hook("remove"),
    };
    return { events, hooks };
  }

  it("run after each helper with the membership before and after", async () => {
    const { events, hooks } = recorder();
    const { qb, acme, carolAtAcme } = await setup({ memberHooks: hooks });
    const invite = await inviteMember(qb, as(alice), {
      organizationId: acme.id,
      email: eve.email!,
    });
    await acceptInvitation(qb, as(eve), invite.id);
    await updateMembership(qb, as(alice), carolAtAcme.id, { role: "admin", status: "disabled" });
    await updateMembership(qb, as(alice), carolAtAcme.id, { modules: ["sales"] });
    await removeMember(qb, as(alice), carolAtAcme.id);
    expect(events).toEqual([
      { name: "invite", action: "invite", before: null, after: ["member", "invited"] },
      {
        name: "accept",
        action: "accept",
        before: ["member", "invited"],
        after: ["member", "active"],
      },
      {
        name: "role",
        action: "update",
        before: ["member", "active"],
        after: ["admin", "disabled"],
      },
      {
        name: "status",
        action: "update",
        before: ["member", "active"],
        after: ["admin", "disabled"],
      },
      {
        name: "update",
        action: "update",
        before: ["member", "active"],
        after: ["admin", "disabled"],
      },
      {
        name: "update",
        action: "update",
        before: ["admin", "disabled"],
        after: ["admin", "disabled"],
      },
      { name: "remove", action: "remove", before: ["admin", "disabled"], after: null },
    ]);
  });

  it("undo the change when a hook throws, and write in the same transaction", async () => {
    const onInvite = vi.fn(async ({ qb, after }: MemberEvent) => {
      await qb.create(
        "notes",
        { text: `invited ${String(after?.email)}` },
        {
          ...system,
          organizationId: after?.organization ?? "",
        },
      );
      if (after?.email?.endsWith("@blocked.example")) {
        throw new MemberHookError("That domain is blocked by the host.");
      }
    });
    const { qb, acme } = await setup({ memberHooks: { onInvite } });
    await expect(
      inviteMember(qb, as(alice), { organizationId: acme.id, email: "x@blocked.example" }),
    ).rejects.toThrow("That domain is blocked by the host.");
    expect(
      await qb.count("memberships", { where: { email: { eq: "x@blocked.example" } } }, system),
    ).toBe(0);
    expect(await qb.count("notes", {}, system)).toBe(0);
    await inviteMember(qb, as(alice), { organizationId: acme.id, email: "ok@example.com" });
    expect(await qb.count("notes", {}, system)).toBe(1);
    expect(onInvite).toHaveBeenCalledTimes(2);
    const error = new MemberHookError("x");
    expect([error.status, error.code, error.name]).toEqual([400, "VALIDATION", "MemberHookError"]);
  });

  it("do not run for direct writes", async () => {
    const onUpdate = vi.fn();
    const { qb, carolAtAcme } = await setup({ memberHooks: { onUpdate } });
    await qb.update("memberships", carolAtAcme.id, { role: "viewer" }, system);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("canManageMember", () => {
  /**
   * Branch-scoped admins, with the branches in the host's own data: an admin with a branch
   * manages only members of that branch; one without a branch manages everyone.
   */
  const branches: Record<string, string> = { bob: "north", carol: "north", dave: "south" };
  const scoped = () =>
    setup({
      canManageMember: ({ allowedByRank, actor, target }) => {
        const branch = branches[actor.id];
        return allowedByRank && (branch === undefined || branch === branches[target.user ?? ""]);
      },
    });

  it("lets the host rule refuse what the rank allows", async () => {
    const { qb, acme, carolAtAcme, daveAtAcme } = await scoped();
    const asBob = inOrg(bob, acme.id);
    expect((await updateMembership(qb, asBob, carolAtAcme.id, { role: "viewer" })).role).toBe(
      "viewer",
    );
    const refused = updateMembership(qb, inOrg(bob, acme.id), daveAtAcme.id, { role: "member" });
    await expect(refused).rejects.toBeInstanceOf(TenancyRuleError);
    await expect(
      updateMembership(qb, inOrg(bob, acme.id), daveAtAcme.id, { role: "member" }),
    ).rejects.toMatchObject({ rule: "cannot-manage" });
    await expect(removeMember(qb, inOrg(bob, acme.id), daveAtAcme.id)).rejects.toMatchObject({
      rule: "cannot-manage",
    });
    await expect(
      inviteMember(qb, inOrg(bob, acme.id), { email: "z@example.com" }),
    ).rejects.toMatchObject({ rule: "cannot-manage" });
    // The rank rule still answers first with its own code.
    await expect(
      updateMembership(qb, inOrg(bob, acme.id), carolAtAcme.id, { role: "owner" }),
    ).rejects.toMatchObject({ rule: "higher-role" });
  });

  it("answers for UIs with the same rules", async () => {
    const { qb, acme, aliceAtAcme, carolAtAcme, daveAtAcme } = await scoped();
    const asBob = inOrg(bob, acme.id);
    expect(await canManageMember(qb, asBob, carolAtAcme)).toBe(true);
    expect(await canManageMember(qb, inOrg(bob, acme.id), daveAtAcme)).toBe(false);
    expect(await canManageMember(qb, inOrg(bob, acme.id), aliceAtAcme, "remove")).toBe(false);
    expect(await canManageMember(qb, inOrg(carol, acme.id), daveAtAcme)).toBe(false);
    expect(await canManageMember(qb, as(staff), daveAtAcme)).toBe(true);
    expect(await canManageMember(qb, system, daveAtAcme)).toBe(true);
    expect(await canManageMember(qb, as(null), daveAtAcme)).toBe(false);
    expect(await canManageMember(qb, as(eve), daveAtAcme)).toBe(false);
  });

  it("defaults to the rank rule", async () => {
    const { qb, acme, aliceAtAcme, daveAtAcme } = await setup();
    expect(await canManageMember(qb, inOrg(bob, acme.id), daveAtAcme)).toBe(true);
    expect(await canManageMember(qb, inOrg(bob, acme.id), aliceAtAcme)).toBe(false);
    expect(await canManageMember(qb, inOrg(dave, acme.id), daveAtAcme)).toBe(false);
  });

  it("does not let skipGuards bypass the host policy or the UI capability check", async () => {
    const { qb, acme, daveAtAcme } = await scoped();
    const ctx = { ...inOrg(bob, acme.id), skipGuards: true };
    expect(await canManageMember(qb, ctx, daveAtAcme)).toBe(false);
    expect(
      await canManageMember(qb, { ...inOrg(carol, acme.id), skipGuards: true }, daveAtAcme),
    ).toBe(false);
    await expect(
      updateMembership(qb, ctx, daveAtAcme.id, { role: "member" }),
    ).rejects.toMatchObject({ rule: "cannot-manage" });
    await expect(removeMember(qb, ctx, daveAtAcme.id)).rejects.toMatchObject({
      rule: "cannot-manage",
    });
    expect(await canManageMember(qb, { ...ctx, overrideAccess: true }, daveAtAcme)).toBe(true);
  });

  it("does not let a permissive host policy bypass the rank guard", async () => {
    const { qb, acme, aliceAtAcme, carolAtAcme } = await setup({ canManageMember: () => true });
    const ctx = inOrg(bob, acme.id);
    expect(await canManageMember(qb, ctx, aliceAtAcme)).toBe(false);
    expect(await canManageMember(qb, ctx, aliceAtAcme, "remove")).toBe(false);
    await expect(
      updateMembership(qb, ctx, carolAtAcme.id, { role: "owner" }),
    ).rejects.toMatchObject({ rule: "higher-role" });
    await expect(removeMember(qb, ctx, aliceAtAcme.id)).rejects.toMatchObject({
      rule: "higher-role",
    });
    await expect(
      inviteMember(qb, ctx, { email: "new@example.com", role: "owner" }),
    ).rejects.toMatchObject({ rule: "higher-role" });
    expect(
      (
        await updateMembership(qb, { ...ctx, overrideAccess: true }, carolAtAcme.id, {
          role: "owner",
        })
      ).role,
    ).toBe("owner");
  });
});

describe("activeOrganization", () => {
  const fromPath = organizationFromPath("/settings/t/:organization");
  const at = (path: string) => new Request(`https://app.example${path}`);

  it("reads the id from the path", () => {
    expect(fromPath(at("/settings/t/org-1/members"))).toBe("org-1");
    expect(fromPath(at("/settings/t/a%20b"))).toBe("a b");
    expect(fromPath(at("/settings/t/%E0%A4%A"))).toBeUndefined();
    expect(fromPath(at("/settings/t"))).toBeUndefined();
    expect(fromPath(at("/other/t/org-1"))).toBeUndefined();
    expect(organizationFromPath("/:lang/t/:organization")(at("/es/t/o2"))).toBe("o2");
    expect(() => organizationFromPath("/settings/t/:id")).toThrow(/:organization/);
  });

  it("selects the organization, checked against memberships", async () => {
    const { qb, acme, globex } = await setup({ activeOrganization: fromPath });
    const req = (path: string, cookie?: string) =>
      new Request(`https://app.example${path}`, cookie ? { headers: { cookie } } : {});
    // The path wins over the cookie.
    const tenant = await resolveTenant(qb, {
      user: bob,
      req: req(`/settings/t/${globex.id}/members`, `quickben-organization=${acme.id}`),
    });
    expect(tenant.organizationId).toBe(globex.id);
    // Without one in the path, the cookie is used.
    const fallback = await resolveTenant(qb, {
      user: bob,
      req: req("/settings", `quickben-organization=${acme.id}`),
    });
    expect(fallback.organizationId).toBe(acme.id);
    await expect(
      resolveTenant(qb, { user: carol, req: req(`/settings/t/${globex.id}`) }),
    ).rejects.toMatchObject({ reason: "not-member" });
    // ctx.organizationId still comes first.
    const explicit = await resolveTenant(qb, {
      user: bob,
      organizationId: acme.id,
      req: req(`/settings/t/${globex.id}`),
    });
    expect(explicit.organizationId).toBe(acme.id);
  });
});
