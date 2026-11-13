"use server";

import { QuickbenError } from "@quickben/core";
import { getQuickben, getRequestContext } from "@quickben/next";
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
import { ORGANIZATIONS } from "../options";

import { getTenancyAdmin } from "./registry";

import type { Quickben, RequestContext } from "@quickben/core";

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  basePath: string;
}

async function scopeFor(key: unknown): Promise<Scope> {
  if (typeof key !== "string") throw new TypeError("Invalid tenancy admin request");
  const instance = getTenancyAdmin(key);
  if (!instance) throw new Error("The admin is not ready on this server yet. Reload the page.");
  const qb = await getQuickben(instance.config);
  const ctx = await getRequestContext(instance.config);
  return { qb, ctx, basePath: instance.basePath };
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function list(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

/** Run a change and say where to go next: `?toast=` on success, `?error=` on a known error. */
async function attempt(
  path: string,
  success: string,
  change: () => Promise<unknown>,
): Promise<string> {
  try {
    await change();
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    return `${path}?error=${encodeURIComponent(error.message)}`;
  }
  return `${path}?toast=${encodeURIComponent(success)}`;
}

/** Make an organization the active one (sets the cookie), or clear the choice. */
export async function switchOrganizationAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const organizationId = text(formData, "organizationId");
  const jar = await cookies();
  let target = basePath;
  if (organizationId === undefined) {
    const cookie = organizationCookie(qb, null);
    jar.set(cookie.name, cookie.value, cookie.options);
  } else {
    target = await attempt(basePath, "Organization switched", async () => {
      const { cookie } = await switchOrganization(qb, ctx, organizationId);
      jar.set(cookie.name, cookie.value, cookie.options);
    });
  }
  revalidatePath(basePath, "layout");
  redirect(target);
}

/** Invite a member to the active organization. */
export async function inviteMemberAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const value = text(formData, "invitee") ?? "";
  const role = text(formData, "role");
  const target = await attempt(`${basePath}/members`, "Invitation created", () =>
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
  const target = await attempt(`${basePath}/members`, "Member updated", () =>
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
  const target = await attempt(`${basePath}/members`, "Member removed", () =>
    removeMember(qb, ctx, id),
  );
  redirect(target);
}

/** Rename the active organization; platform staff also set status and modules. */
export async function updateOrganizationAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const target = await attempt(`${basePath}/organization`, "Organization saved", async () => {
    const tenant = await resolveTenant(qb, ctx);
    const data: Record<string, unknown> = {};
    const name = text(formData, "name");
    if (name !== undefined) data.name = name;
    if (tenant.platform) {
      const status = text(formData, "status");
      if (status !== undefined) data.status = status;
      data.modules = list(formData, "modules");
    }
    await qb.update(ORGANIZATIONS, tenant.organizationId ?? "", data, ctx);
  });
  redirect(target);
}

/** Create an organization and make it the active one. */
export async function createOrganizationAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const jar = await cookies();
  const target = await attempt(`${basePath}/organization`, "Organization created", async () => {
    const org = await qb.create(
      ORGANIZATIONS,
      { name: text(formData, "name") ?? "", slug: text(formData, "slug") ?? "" },
      ctx,
    );
    const cookie = organizationCookie(qb, org.id);
    jar.set(cookie.name, cookie.value, cookie.options);
  });
  revalidatePath(basePath, "layout");
  redirect(target);
}
