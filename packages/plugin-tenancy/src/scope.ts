import { ConfigError, ForbiddenError } from "@quickben/core";

import { apiOf } from "./collections";
import { getTenancy } from "./options";
import { OrganizationError, tenantOf } from "./tenant";

import type { TenancyState } from "./collections";
import type {
  AccessArgs,
  AccessFn,
  AccessOperation,
  AnyCollection,
  CollectionAccess,
  Fields,
  Quickben,
  RequestContext,
} from "@quickben/core";

type AnyAccessFn = (args: AccessArgs) => unknown;

const operations: readonly AccessOperation[] = ["read", "create", "update", "delete"];

const authenticated: AnyAccessFn = ({ user }) => user !== null;

/** Keys of the modules that list `slug`. */
export function modulesOf(qb: Quickben, slug: string): string[] {
  return qb.config.modules
    .filter((module) => module.collections.includes(slug))
    .map((module) => module.key);
}

function scopedRule(
  state: TenancyState,
  collection: AnyCollection,
  operation: AccessOperation,
): AnyAccessFn {
  const base = collection.access[operation] ?? authenticated;
  return async (args) => {
    const result = (await base(args)) as boolean | object;
    if (result === false || !args.user) return false;
    const qb = apiOf(state, args.qb);
    const tenant = await tenantOf(qb, state.tenancy, args.ctx);
    if (!tenant.platform) {
      const needed = operation === "read" ? "read" : "write";
      if (!tenant.capabilities.includes(needed)) return false;
      const keys = modulesOf(qb, collection.slug);
      if (keys.length > 0 && !keys.some((key) => tenant.modules.includes(key))) return false;
    }
    if (tenant.organizationId === null) return result;
    const filter = { organization: { eq: tenant.organizationId } };
    return result === true ? filter : { and: [result, filter] };
  };
}

/** Wrap the access rules and hooks of a collection that has an `organization` field. */
export function scopeCollection(state: TenancyState, collection: AnyCollection): AnyCollection {
  const { tenancy } = state;
  const access = Object.fromEntries(
    operations.map((operation) => [operation, scopedRule(state, collection, operation)]),
  );

  const assignOrganization = async ({
    operation,
    data,
    ctx,
    qb,
  }: {
    operation: string;
    data: Record<string, unknown>;
    ctx: RequestContext;
    qb: Quickben;
  }) => {
    if (operation !== "create" || data.organization !== undefined) return data;
    if (ctx.overrideAccess === true) {
      return ctx.organizationId ? { ...data, organization: ctx.organizationId } : data;
    }
    if (!ctx.user) return data;
    const tenant = await tenantOf(qb, tenancy, ctx);
    return tenant.organizationId ? { ...data, organization: tenant.organizationId } : data;
  };

  const keepOrganization = async ({
    operation,
    data,
    original,
    ctx,
    qb,
  }: {
    operation: string;
    data: Record<string, unknown>;
    original: Record<string, unknown> | null;
    ctx: RequestContext;
    qb: Quickben;
  }) => {
    if (operation !== "update" || ctx.overrideAccess === true || !original) return;
    if (data.organization === undefined || data.organization === original.organization) return;
    const tenant = ctx.user ? await tenantOf(qb, tenancy, ctx) : null;
    if (!tenant?.platform) {
      throw new ForbiddenError("A document cannot move to another organization");
    }
  };

  return {
    ...collection,
    access,
    hooks: {
      ...collection.hooks,
      beforeValidate: [assignOrganization, ...(collection.hooks.beforeValidate ?? [])],
      beforeChange: [...(collection.hooks.beforeChange ?? []), keepOrganization],
    },
  };
}

/**
 * Rules returned by {@link moduleAccess}. Typed so they do not change the field inference of
 * `defineCollection`. Pass your field type (`moduleAccess<typeof myFields>(…)`) to type the
 * filters of your own rules.
 */
export type ModuleAccess = Readonly<Record<AccessOperation, AccessFn<never>>>;

/**
 * Access rules for a collection that belongs to a module but is not tenant-scoped. Each rule
 * first checks that the user may use `moduleKey` in the active organization, then runs yours
 * (a missing rule allows signed-in users).
 *
 * ```ts
 * access: moduleAccess("reports", { read: () => true })
 * ```
 */
export function moduleAccess<F extends Fields = Fields>(
  moduleKey: string,
  access: CollectionAccess<F> = {},
): ModuleAccess {
  const wrap = (operation: AccessOperation) => {
    const base = access[operation] ?? authenticated;
    return async (args: AccessArgs) => {
      if (!args.user) return false;
      if (!args.qb) throw new ConfigError("moduleAccess: pass `qb` to checkAccess");
      if (!(await canUseModule(args.qb, args.ctx, moduleKey))) return false;
      return base(args);
    };
  };
  return Object.fromEntries(
    operations.map((operation) => [operation, wrap(operation)]),
  ) as unknown as ModuleAccess;
}

/**
 * Whether the user may use a module in the active organization: the organization has it
 * enabled and the membership grants it. Platform staff may use every module. Returns `false`
 * when there is no usable active organization.
 */
export async function canUseModule(
  qb: Quickben,
  ctx: RequestContext,
  moduleKey: string,
): Promise<boolean> {
  const tenancy = getTenancy(qb);
  if (!ctx.user) return false;
  try {
    const tenant = await tenantOf(qb, tenancy, ctx);
    return tenant.platform || tenant.modules.includes(moduleKey);
  } catch (error) {
    if (error instanceof OrganizationError) return false;
    throw error;
  }
}
