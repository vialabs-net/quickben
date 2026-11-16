import {
  ConfigError,
  defineCollection,
  fields as f,
  NotFoundError,
  ValidationError,
} from "@quickben/core";
import { z } from "zod";

import { entitlementList, moduleKeys, storeEntitlements } from "./entitlements";
import {
  ALL_MODULES,
  capabilitiesOf,
  MEMBERSHIPS,
  ORGANIZATIONS,
  rankOf,
  statusesWith,
} from "./options";
import {
  eq,
  guardsSkipped,
  invalidateTenants,
  myMemberships,
  rawFind,
  rawOrganization,
  TenancyRuleError,
  trustedEmail,
} from "./tenant";

import type { ModuleEntitlement } from "./entitlements";
import type { Capability, ManageMemberArgs, ResolvedTenancy } from "./options";
import type { MembershipRecord } from "./tenant";
import type {
  AccessArgs,
  DocumentData,
  JsonField,
  Quickben,
  QuickbenUser,
  RequestContext,
} from "@quickben/core";

/** Shared state of one `tenancy()` plugin. */
export interface TenancyState {
  readonly tenancy: ResolvedTenancy;
  /** Set in `onInit`. Used when an access rule runs without `qb` (for example from a UI). */
  rootQb: Quickben | undefined;
}

/** The local API of an access call. */
export function apiOf(state: TenancyState, qb: Quickben | undefined): Quickben {
  const api = qb ?? state.rootQb;
  if (!api) {
    throw new ConfigError(
      "tenancy: pass `qb` to checkAccess, or create the Quickben instance first",
    );
  }
  return api;
}

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const moduleList = z.array(z.string().min(1));

/** A JSON list of module entitlements that a hook fills when the input leaves it out. */
type FilledModules = JsonField<ModuleEntitlement[], true, true>;

/** Fields of the `organizations` collection. */
export function organizationFields(tenancy: ResolvedTenancy) {
  const statuses = tenancy.statuses.map((status) => status.name) as [string, ...string[]];
  return {
    name: f.text({ required: true, maxLength: 200 }),
    slug: f.text({
      required: true,
      unique: true,
      maxLength: 63,
      validate: (value) =>
        slugPattern.test(value) || "Use lowercase letters, digits and -, e.g. acme-inc",
    }),
    status: f.select({ options: statuses, required: true, default: tenancy.defaultStatus }),
    /** Enabled modules: keys or `{ key, expiresAt, source }`. Filled from `defaultModules`. */
    modules: f.json({ schema: entitlementList, required: true }) as unknown as FilledModules,
    metadata: f.json(),
  };
}

/** Fields of the `memberships` collection. */
export function membershipFields(tenancy: ResolvedTenancy) {
  const roles = tenancy.roles.map((role) => role.name) as [string, ...string[]];
  return {
    organization: f.relation({ to: ORGANIZATIONS, required: true, index: true }),
    /** User id from the auth adapter. Empty for an invitation by email that is not accepted. */
    user: f.text({ index: true }),
    email: f.email({ index: true }),
    role: f.select({ options: roles, required: true, default: tenancy.defaultRole }),
    status: f.select({
      options: ["invited", "active", "disabled"],
      required: true,
      default: "invited",
    }),
    /**
     * Granted module keys. `["*"]` = every module of the organization. Empty = every module,
     * or none with `emptyModules: "none"`. New memberships get every module.
     */
    modules: f.json({
      schema: moduleList,
      required: true,
      default: () => (tenancy.emptyModules === "none" ? [ALL_MODULES] : []),
    }),
    invitedBy: f.text(),
    invitedAt: f.datetime(),
    joinedAt: f.datetime(),
    /** `organization:user:<id>` or `organization:email:<email>`. Keeps memberships unique. */
    memberKey: f.text({ unique: true, admin: { hidden: true, readOnly: true } }),
  };
}

const system: RequestContext = { user: null, overrideAccess: true };

function isPlatform(tenancy: ResolvedTenancy, user: QuickbenUser | null): boolean {
  return user !== null && tenancy.isPlatformAdmin(user);
}

/** Override or platform staff: skip the per-organization checks. */
function isTrusted(tenancy: ResolvedTenancy, ctx: RequestContext): boolean {
  return ctx.overrideAccess === true || isPlatform(tenancy, ctx.user);
}

/**
 * Ids of the organizations where the user's role has `capability`. `read` needs a status with
 * `limited` or `full` access; every other capability needs `full` access.
 */
async function organizationsWith(
  state: TenancyState,
  args: AccessArgs,
  capability: Capability,
): Promise<string[]> {
  const qb = apiOf(state, args.qb);
  const memberships = await myMemberships(qb, args.ctx);
  const ids = memberships
    .filter((m) => capabilitiesOf(state.tenancy, m.role).includes(capability))
    .map((m) => m.organization);
  if (ids.length === 0) return ids;
  const tenancy = state.tenancy;
  const usable =
    capability === "read"
      ? statusesWith(tenancy, "full", "limited")
      : statusesWith(tenancy, "full");
  const active = await rawFind(
    qb,
    ORGANIZATIONS,
    { field: "id", op: "in", value: ids },
    { field: "status", op: "in", value: usable },
  );
  const activeIds = new Set(active.map((org) => org.id));
  return ids.filter((id) => activeIds.has(id));
}

function knownModules(qb: Quickben, keys: readonly string[]): void {
  const seen = new Set<string>();
  const known = new Set(qb.config.modules.map((module) => module.key));
  const issues = keys
    .map((key, index) => ({ key, index }))
    .flatMap(({ key, index }) => {
      const path = `modules.${String(index)}`;
      if (!known.has(key)) return [{ path, message: `Unknown module "${key}"` }];
      if (seen.has(key)) return [{ path, message: `Module "${key}" is listed twice` }];
      seen.add(key);
      return [];
    });
  if (issues.length > 0) throw new ValidationError(issues);
}

function sameList(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The `organizations` collection. */
export function organizationsCollection(state: TenancyState) {
  const { tenancy } = state;
  return defineCollection({
    slug: ORGANIZATIONS,
    labels: { singular: "Organization", plural: "Organizations" },
    fields: organizationFields(tenancy),
    access: {
      read: async (args) => {
        if (!args.user) return false;
        if (isPlatform(tenancy, args.user)) return true;
        return { id: { in: await organizationsWith(state, args, "read") } };
      },
      create: ({ user }) =>
        user !== null && (isPlatform(tenancy, user) || tenancy.canCreateOrganization(user)),
      update: async (args) => {
        if (!args.user) return false;
        if (isPlatform(tenancy, args.user)) return true;
        return { id: { in: await organizationsWith(state, args, "organization:manage") } };
      },
      delete: async (args) => {
        if (!args.user) return false;
        if (isPlatform(tenancy, args.user)) return true;
        return { id: { in: await organizationsWith(state, args, "organization:delete") } };
      },
    },
    hooks: {
      beforeValidate: [
        ({ operation, data, original, ctx, qb }) => {
          const trusted = isTrusted(tenancy, ctx);
          if (operation === "create") {
            if (!trusted && (data.modules !== undefined || data.status !== tenancy.defaultStatus)) {
              throw new TenancyRuleError(
                "platform-only",
                "Only platform staff can set modules or status",
              );
            }
            if (data.modules !== undefined) return data;
            const all = qb.config.modules.map((module) => module.key);
            const modules = tenancy.defaultModules === "all" ? all : [...tenancy.defaultModules];
            return { ...data, modules };
          }
          const changesModules =
            data.modules !== undefined && !sameList(data.modules, original.modules);
          const changesStatus = data.status !== undefined && data.status !== original.status;
          if (!trusted && (changesModules || changesStatus)) {
            throw new TenancyRuleError(
              "platform-only",
              "Only platform staff can change modules or status",
            );
          }
          return data;
        },
      ],
      beforeChange: [
        ({ data, qb }) => {
          if (data.modules === undefined) return data;
          knownModules(qb, moduleKeys(data.modules));
          return { ...data, modules: storeEntitlements(data.modules) };
        },
      ],
      afterChange: [
        async ({ operation, doc, ctx, qb }) => {
          invalidateTenants();
          const user = ctx.user;
          if (operation !== "create" || !user || isPlatform(tenancy, user)) return;
          await qb.create(
            MEMBERSHIPS,
            {
              organization: doc.id,
              user: user.id,
              email: user.email ?? null,
              role: tenancy.ownerRole,
              status: "active",
            },
            system,
          );
        },
      ],
      beforeDelete: [
        async ({ id, qb }) => {
          if (tenancy.onOrganizationDelete === "cascade") await deleteScoped(tenancy, qb, id);
          else await assertNoScoped(tenancy, qb, id);
        },
      ],
      afterDelete: [
        async ({ id, qb }) => {
          // Straight to the adapter: the last-owner rule does not apply to a deleted organization.
          for (const row of await rawFind(qb, MEMBERSHIPS, eq("organization", id))) {
            await qb.db.delete({ collection: MEMBERSHIPS, id: row.id as string });
          }
          invalidateTenants();
        },
      ],
    },
    admin: {
      useAsTitle: "name",
      defaultColumns: ["name", "slug", "status"],
      group: "Organization",
    },
  });
}

/** Throw `not-empty` while the organization has scoped documents. */
async function assertNoScoped(tenancy: ResolvedTenancy, qb: Quickben, id: string) {
  const counts: string[] = [];
  for (const slug of tenancy.scope) {
    const count = await qb.db.count({ collection: slug, where: eq("organization", id) });
    if (count > 0) counts.push(`${String(count)} in ${slug}`);
  }
  if (counts.length > 0) {
    throw new TenancyRuleError(
      "not-empty",
      `The organization still has documents (${counts.join(", ")}). Delete them first.`,
    );
  }
}

const CASCADE_BATCH = 100;

/**
 * Delete every scoped document of an organization through the local API, so the hooks of
 * the scoped collections run. `qb` is bound to the transaction of the organization delete.
 */
async function deleteScoped(tenancy: ResolvedTenancy, qb: Quickben, id: string) {
  const ctx: RequestContext = { ...system, organizationId: id };
  // Scope order: a parent (for example a template) can delete its children in its own hooks.
  for (const slug of tenancy.scope) {
    for (;;) {
      const rows = await qb.db.find({
        collection: slug,
        where: eq("organization", id),
        select: ["id"],
        limit: CASCADE_BATCH,
      });
      if (rows.length === 0) break;
      for (const row of rows) await deleteIfThere(qb, slug, row.id as string, ctx);
    }
  }
}

/** Delete a document unless a hook of an earlier delete already removed it. */
async function deleteIfThere(qb: Quickben, slug: string, id: string, ctx: RequestContext) {
  try {
    await qb.delete(slug, id, ctx);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
}

function memberKey(data: DocumentData): string | null {
  const org = data.organization as string;
  if (typeof data.user === "string" && data.user !== "") return `${org}:user:${data.user}`;
  if (typeof data.email === "string" && data.email !== "") return `${org}:email:${data.email}`;
  return null;
}

async function assertModulesGranted(qb: Quickben, orgId: string, modules: unknown) {
  if (!Array.isArray(modules) || modules.length === 0) return;
  if (modules.includes(ALL_MODULES)) {
    if (modules.length === 1) return;
    throw new ValidationError([
      { path: "modules", message: `Use "${ALL_MODULES}" alone: it grants every module` },
    ]);
  }
  const org = await rawOrganization(qb, orgId);
  const enabled = new Set(moduleKeys(org?.modules));
  const issues = (modules as string[])
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !enabled.has(key))
    .map(({ key, index }) => ({
      path: `modules.${String(index)}`,
      message: `Module "${key}" is not enabled for the organization`,
    }));
  if (issues.length > 0) throw new ValidationError(issues);
}

/** Throw when `membership` is the organization's last active owner and would stop being one. */
async function assertKeepsOwner(
  tenancy: ResolvedTenancy,
  qb: Quickben,
  membership: DocumentData,
  next: { role: unknown; status: unknown } | null,
) {
  const isOwner = membership.role === tenancy.ownerRole && membership.status === "active";
  if (!isOwner) return;
  if (next?.role === tenancy.ownerRole && next.status === "active") return;
  const owners = await rawFind(
    qb,
    MEMBERSHIPS,
    eq("organization", membership.organization),
    eq("role", tenancy.ownerRole),
    eq("status", "active"),
  );
  if (owners.every((owner) => owner.id === membership.id)) {
    throw new TenancyRuleError(
      "last-owner",
      "An organization needs at least one active owner. Make someone else owner first.",
    );
  }
}

/** A user acting inside an organization, and their membership there. */
export interface Actor {
  user: QuickbenUser;
  membership: MembershipRecord | undefined;
}

/**
 * The acting user and their membership in `orgId`. `null` for trusted callers (override,
 * platform staff): the actor rules do not apply to them.
 */
export async function actorIn(
  tenancy: ResolvedTenancy,
  qb: Quickben,
  ctx: RequestContext,
  orgId: string,
): Promise<Actor | null> {
  if (isTrusted(tenancy, ctx) || !ctx.user) return null;
  const memberships = await myMemberships(qb, ctx);
  return { user: ctx.user, membership: memberships.find((m) => m.organization === orgId) };
}

/** The first of `roles` that ranks above the actor's role, if any. */
function roleAbove(tenancy: ResolvedTenancy, actor: Actor, roles: unknown[]): string | undefined {
  const own = rankOf(tenancy, actor.membership?.role ?? "");
  return roles.find(
    (role): role is string => typeof role === "string" && rankOf(tenancy, role) < own,
  );
}

/** Whether the actor's role ranks at least as high as every role in `roles`. */
export function rankAllows(tenancy: ResolvedTenancy, actor: Actor, roles: unknown[]): boolean {
  return roleAbove(tenancy, actor, roles) === undefined;
}

/**
 * The rank rule, then `canManageMember` when the host gives one. Throws `higher-role` when
 * the rank rule decides, `cannot-manage` when the host rule refuses a change the rank allows.
 */
async function assertMayManage(
  tenancy: ResolvedTenancy,
  qb: Quickben,
  actor: Actor,
  check: Pick<ManageMemberArgs, "action" | "target" | "next">,
) {
  const roles = [check.next?.role, check.target.role];
  const above = roleAbove(tenancy, actor, roles);
  const allowed = await mayManage(tenancy, qb, actor, check, above === undefined);
  if (allowed) return;
  if (above !== undefined) {
    throw new TenancyRuleError("higher-role", `Only a higher role can manage the role "${above}"`);
  }
  throw new TenancyRuleError("cannot-manage", "You cannot manage this member");
}

/** The rank rule, restricted further by `canManageMember` when provided. */
export async function mayManage(
  tenancy: ResolvedTenancy,
  qb: Quickben,
  actor: Actor,
  check: Pick<ManageMemberArgs, "action" | "target" | "next">,
  allowedByRank: boolean,
): Promise<boolean> {
  if (!allowedByRank || !tenancy.canManageMember) return allowedByRank;
  return tenancy.canManageMember({
    ...check,
    actor: actor.user,
    actorMembership: actor.membership ?? null,
    allowedByRank,
    qb,
  });
}

function managesMembers(tenancy: ResolvedTenancy, role: unknown): boolean {
  return typeof role === "string" && capabilitiesOf(tenancy, role).includes("members:manage");
}

/** A membership keeps its organization, and its user once set. */
function assertSameOwner(original: DocumentData, next: DocumentData) {
  if (next.organization !== original.organization) {
    throw new ValidationError([
      { path: "organization", message: "A membership cannot move to another organization" },
    ]);
  }
  if (original.user !== null && next.user !== original.user) {
    throw new ValidationError([
      { path: "user", message: "A membership cannot move to another user" },
    ]);
  }
}

/** Self-demotion and manage rules for a create (`original` null) or an update. */
async function assertActorMayChange(
  tenancy: ResolvedTenancy,
  qb: Quickben,
  actor: Actor,
  original: DocumentData | null,
  next: DocumentData,
) {
  if (original?.user === actor.user.id && managesMembers(tenancy, original.role)) {
    if (next.role !== original.role || next.status !== original.status) {
      throw new TenancyRuleError(
        "own-role",
        "You cannot change your own role or status. Ask another owner or admin.",
      );
    }
  }
  await assertMayManage(tenancy, qb, actor, {
    action: original ? "update" : "invite",
    target: (original ?? next) as MembershipRecord,
    next: next as MembershipRecord,
  });
}

/** Derived fields: unique key, who invited, and when. */
function stamps(next: DocumentData, operation: "create" | "update", ctx: RequestContext) {
  const now = new Date().toISOString();
  const extra: DocumentData = { memberKey: memberKey(next) };
  if (operation === "create") {
    extra.invitedBy = next.invitedBy ?? ctx.user?.id ?? null;
    if (next.status === "invited") extra.invitedAt = next.invitedAt ?? now;
  }
  if (next.status === "active" && !next.joinedAt) extra.joinedAt = now;
  return extra;
}

/** The `memberships` collection, with the membership guard rails. */
export function membershipsCollection(state: TenancyState) {
  const { tenancy } = state;
  const manageFilter = async (args: AccessArgs) => ({
    organization: { in: await organizationsWith(state, args, "members:manage") },
  });
  return defineCollection({
    slug: MEMBERSHIPS,
    labels: { singular: "Membership", plural: "Memberships" },
    fields: membershipFields(tenancy),
    access: {
      read: async (args) => {
        const user = args.user;
        if (!user) return false;
        if (isPlatform(tenancy, user)) return true;
        const email = trustedEmail(user);
        const mine = [{ user: { eq: user.id } }, ...(email ? [{ email: { eq: email } }] : [])];
        return {
          or: [...mine, { organization: { in: await organizationsWith(state, args, "read") } }],
        };
      },
      create: async (args) => {
        if (!args.user) return false;
        return isPlatform(tenancy, args.user) || manageFilter(args);
      },
      update: async (args) => {
        if (!args.user) return false;
        return isPlatform(tenancy, args.user) || manageFilter(args);
      },
      delete: async (args) => {
        const user = args.user;
        if (!user) return false;
        if (isPlatform(tenancy, user)) return true;
        return { or: [await manageFilter(args), { user: { eq: user.id } }] };
      },
    },
    hooks: {
      beforeValidate: [
        ({ data }) =>
          typeof data.email === "string"
            ? { ...data, email: data.email.trim().toLowerCase() }
            : data,
      ],
      beforeChange: [
        async ({ operation, data, original, ctx, qb }) => {
          const next: DocumentData = { ...original, ...data };
          if (original) assertSameOwner(original, next);
          if (!next.user && !next.email) {
            throw new ValidationError([{ path: "user", message: "Give a user id or an email" }]);
          }
          const organization = next.organization as string;
          if (data.modules !== undefined)
            await assertModulesGranted(qb, organization, data.modules);
          const actor = await actorIn(tenancy, qb, ctx, organization);
          if (actor) await assertActorMayChange(tenancy, qb, actor, original, next);
          if (original && !guardsSkipped(ctx)) {
            await assertKeepsOwner(tenancy, qb, original, { role: next.role, status: next.status });
          }
          return { ...data, ...stamps(next, operation, ctx) };
        },
      ],
      afterChange: [
        () => {
          invalidateTenants();
        },
      ],
      beforeDelete: [
        async ({ doc, ctx, qb }) => {
          const actor = await actorIn(tenancy, qb, ctx, doc.organization);
          if (actor) {
            const self = doc.user === actor.user.id;
            if (self && managesMembers(tenancy, doc.role)) {
              throw new TenancyRuleError(
                "own-membership",
                "You cannot remove your own owner or admin membership. Ask another owner or admin.",
              );
            }
            if (!self) {
              await assertMayManage(tenancy, qb, actor, {
                action: "remove",
                target: doc,
                next: null,
              });
            }
          }
          if (!guardsSkipped(ctx)) await assertKeepsOwner(tenancy, qb, doc, null);
        },
      ],
      afterDelete: [
        () => {
          invalidateTenants();
        },
      ],
    },
    admin: {
      useAsTitle: "email",
      defaultColumns: ["user", "email", "role", "status"],
      group: "Organization",
    },
  });
}

/** Type of the `organizations` collection. */
export type OrganizationsCollection = ReturnType<typeof organizationsCollection>;
/** Type of the `memberships` collection. */
export type MembershipsCollection = ReturnType<typeof membershipsCollection>;
