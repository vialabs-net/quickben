"use server";

import { getAdminI18n } from "@quickben/admin";
import { parseFormData } from "@quickben/admin/forms";
import { createAdminI18n } from "@quickben/admin/i18n";
import { getQuickben, isTimeZone, QuickbenError, ValidationError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  inviteMember,
  organizationCookie,
  removeMember,
  resolveTenant,
  switchOrganization,
  updateMembership,
} from "../api";
import { toGrant } from "../entitlements";
import { MEMBERSHIPS, ORGANIZATIONS } from "../options";

import { errorCode } from "./feedback";
import { addedFields, ownMembershipFields, ownOrganizationFields, TIME_ZONE_FIELD } from "./fields";
import { getTenancyAdmin } from "./registry";

import type { ModuleEntitlement } from "../entitlements";
import type { ToastCode } from "./feedback";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  basePath: string;
  config: QuickbenConfig;
}

async function scopeFor(key: unknown): Promise<Scope> {
  if (typeof key !== "string") throw new TypeError("Invalid tenancy admin request");
  const instance = getTenancyAdmin(key);
  if (!instance) throw new Error("The admin is not ready on this server yet. Reload the page.");
  const qb = await getQuickben(instance.config);
  const ctx = await getRequestContext(instance.config);
  return { qb, ctx, basePath: instance.basePath, config: instance.config };
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function list(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

/**
 * Run a change and say where to go next: `?toast=<code>` on success, `?error=<code>` on a
 * Quickben error. The pages map codes to fixed messages, so the URL never carries text.
 */
async function attempt(
  path: string,
  success: ToastCode | null,
  change: () => Promise<unknown>,
): Promise<string> {
  try {
    await change();
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    return `${path}?error=${errorCode(error)}`;
  }
  return success === null ? path : `${path}?toast=${success}`;
}

/**
 * Make an organization the active one (sets the cookie), or clear the choice. Goes to the
 * dashboard; an error is shown on the Organization settings page.
 */
export async function switchOrganizationAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const organizationId = text(formData, "organizationId");
  const jar = await cookies();
  let target = basePath;
  if (organizationId === undefined) {
    const cookie = organizationCookie(qb, null, ctx.req);
    jar.set(cookie.name, cookie.value, cookie.options);
  } else {
    const result = await attempt(`${basePath}/organization`, null, async () => {
      const { cookie } = await switchOrganization(qb, ctx, organizationId);
      jar.set(cookie.name, cookie.value, cookie.options);
    });
    if (result.includes("?error=")) target = result;
  }
  revalidatePath(basePath, "layout");
  redirect(target);
}

/** Invite a member to the active organization. */
export async function inviteMemberAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const value = text(formData, "invitee") ?? "";
  const role = text(formData, "role");
  const target = await attempt(`${basePath}/members`, "invited", () =>
    inviteMember(qb, ctx, {
      ...(value.includes("@") ? { email: value } : { userId: value }),
      ...(role === undefined ? {} : { role }),
    }),
  );
  redirect(target);
}

/** Change the role, status and modules of a membership. */
export async function updateMemberAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const id = text(formData, "membershipId") ?? "";
  const role = text(formData, "role");
  const status = text(formData, "status");
  const target = await attempt(`${basePath}/members`, "member-updated", () =>
    updateMembership(qb, ctx, id, {
      ...(role === undefined ? {} : { role }),
      ...(status === "invited" || status === "active" || status === "disabled" ? { status } : {}),
      modules: list(formData, "modules"),
    }),
  );
  redirect(target);
}

/** Remove a membership. */
export async function removeMemberAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const id = text(formData, "membershipId") ?? "";
  const target = await attempt(`${basePath}/members`, "member-removed", () =>
    removeMember(qb, ctx, id),
  );
  redirect(target);
}

/**
 * Values of the fields a host added to `slug`, read like the admin edit form reads them.
 * Fields the user may not update are left out. Throws `ValidationError` on a bad value.
 */
async function addedData(
  scope: Scope,
  slug: string,
  own: ReadonlySet<string>,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const base = await getAdminI18n(scope.config);
  const zone = text(formData, TIME_ZONE_FIELD);
  const i18n =
    zone !== undefined && isTimeZone(zone)
      ? createAdminI18n({ ...base.data, timeZone: zone })
      : base;
  const meta = await addedFields(scope.qb, scope.ctx, slug, own, i18n.locale);
  if (!meta) return {};
  const { data, errors } = parseFormData(meta.fields, formData, i18n, "update");
  const issues = Object.entries(errors).map(([path, message]) => ({ path, message }));
  if (issues.length > 0) throw new ValidationError(issues);
  return data;
}

/** Ticked module keys, keeping the expiry and source of modules that stay enabled. */
function keepEntitlements(
  current: readonly ModuleEntitlement[],
  keys: readonly string[],
): ModuleEntitlement[] {
  const byKey = new Map(current.map((entry) => [toGrant(entry).key, entry]));
  return keys.map((moduleKey) => byKey.get(moduleKey) ?? moduleKey);
}

/** Save the settings of the active organization: name, added fields, and for platform staff status and modules. */
export async function updateOrganizationAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const { qb, ctx, basePath } = scope;
  const target = await attempt(`${basePath}/organization`, "organization-saved", async () => {
    const tenant = await resolveTenant(qb, ctx);
    const data = await addedData(scope, ORGANIZATIONS, ownOrganizationFields, formData);
    const name = text(formData, "name");
    if (name !== undefined) data.name = name;
    if (tenant.platform) {
      const status = text(formData, "status");
      if (status !== undefined) data.status = status;
      data.modules = keepEntitlements(
        tenant.organization?.modules ?? [],
        list(formData, "modules"),
      );
    }
    await qb.update(ORGANIZATIONS, tenant.organizationId ?? "", data, ctx);
  });
  redirect(target);
}

/** Save the fields a host added to a membership (the member details dialog). */
export async function updateMemberDetailsAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const { qb, ctx, basePath } = scope;
  const id = text(formData, "membershipId") ?? "";
  const target = await attempt(`${basePath}/members`, "member-updated", async () => {
    const data = await addedData(scope, MEMBERSHIPS, ownMembershipFields, formData);
    await qb.update(MEMBERSHIPS, id, data, ctx);
  });
  redirect(target);
}

/** Create an organization and make it the active one. */
export async function createOrganizationAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const jar = await cookies();
  const target = await attempt(`${basePath}/organization`, "organization-created", async () => {
    const org = await qb.create(
      ORGANIZATIONS,
      { name: text(formData, "name") ?? "", slug: text(formData, "slug") ?? "" },
      ctx,
    );
    const cookie = organizationCookie(qb, org.id, ctx.req);
    jar.set(cookie.name, cookie.value, cookie.options);
  });
  revalidatePath(basePath, "layout");
  redirect(target);
}
