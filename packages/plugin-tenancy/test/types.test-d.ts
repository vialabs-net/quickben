import { getQuickben } from "@quickben/core";
import { describe, expectTypeOf, test } from "vitest";

import {
  listMyOrganizations,
  organizationFromPath,
  resolveTenant,
  switchOrganization,
} from "../src";

import type {
  CanManageMember,
  ManageMemberArgs,
  MemberEvent,
  MemberHook,
  MemberHooks,
  MemberModules,
  MembershipPatch,
  MembershipRecord,
  ModuleEntitlement,
  MyOrganization,
  OrganizationStatus,
  SwitchResult,
  TenancyOptions,
  Tenant,
} from "../src";
import type {
  OrganizationSection,
  OrganizationSectionProps,
  TenancyAdminOptions,
} from "../src/admin";
import type { makeConfig } from "./setup";
import type {
  InferCreateInput,
  InferDoc,
  InferRegistry,
  InferWhere,
  RequestContext,
} from "@quickben/core";

type Config = ReturnType<typeof makeConfig>;
type R = InferRegistry<Config>;
declare const config: Config;
declare const ctx: RequestContext;

describe("tenancy types", () => {
  test("adds organizations and memberships to the registry", () => {
    expectTypeOf<keyof R>().toEqualTypeOf<
      "posts" | "notes" | "reports" | "organizations" | "memberships"
    >();
    type Org = InferDoc<R["organizations"]>;
    expectTypeOf<Org["slug"]>().toEqualTypeOf<string>();
    // Statuses are configurable (`tenancy({ statuses })`), so the type is a string.
    expectTypeOf<Org["status"]>().toEqualTypeOf<string>();
    expectTypeOf<Org["modules"]>().toEqualTypeOf<ModuleEntitlement[]>();
    type Membership = InferDoc<R["memberships"]>;
    expectTypeOf<Membership["status"]>().toEqualTypeOf<"invited" | "active" | "disabled">();
    expectTypeOf<Membership["user"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InferCreateInput<R["organizations"]>["modules"]>().toEqualTypeOf<
      ModuleEntitlement[] | undefined
    >();
    expectTypeOf<["sales", { key: "reports"; expiresAt: "2030-01-01T00:00:00Z" }]>().toExtend<
      ModuleEntitlement[]
    >();
  });

  test("infers the organization field on scoped collections", () => {
    type Post = InferDoc<R["posts"]>;
    expectTypeOf<Post["organization"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["title"]>().toEqualTypeOf<string>();
    expectTypeOf<InferCreateInput<R["posts"]>["organization"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<{ organization: { eq: "o1" } }>().toExtend<InferWhere<R["posts"]>>();
    type HasOrg = "organization" extends keyof InferDoc<R["reports"]> ? true : false;
    expectTypeOf<HasOrg>().toEqualTypeOf<false>();
    // moduleAccess does not widen the field inference of the collection.
    expectTypeOf<InferDoc<R["reports"]>["name"]>().toEqualTypeOf<string>();
  });

  test("the local API and the helpers take the typed instance", async () => {
    const qb = await getQuickben(config);
    const post = await qb.create("posts", { title: "Hi" }, ctx);
    expectTypeOf(post.organization).toEqualTypeOf<string>();
    const page = await qb.find("posts", { where: { organization: { eq: "o1" } } }, ctx);
    expectTypeOf(page.docs[0]!.organization).toEqualTypeOf<string>();
    expectTypeOf(await resolveTenant(qb, ctx)).toEqualTypeOf<Tenant>();
    expectTypeOf(await listMyOrganizations(qb, ctx)).toEqualTypeOf<MyOrganization[]>();
    expectTypeOf(await switchOrganization(qb, ctx, "o1")).toEqualTypeOf<SwitchResult>();
  });

  test("statuses, delete mode and platform roles are options", () => {
    expectTypeOf<{ access: "full" }>().toExtend<OrganizationStatus>();
    expectTypeOf<{
      access: { members: "limited"; staff: "full" };
    }>().toExtend<OrganizationStatus>();
    expectTypeOf<{ access: "partial" }>().not.toExtend<OrganizationStatus>();
    expectTypeOf<TenancyOptions["onOrganizationDelete"]>().toEqualTypeOf<
      "restrict" | "cascade" | undefined
    >();
    expectTypeOf<TenancyOptions["platformRoles"]>().toEqualTypeOf<readonly string[] | undefined>();
  });

  test("settings sections get the organization and the tenant", () => {
    expectTypeOf<OrganizationSectionProps["tenant"]>().toEqualTypeOf<Tenant>();
    expectTypeOf<OrganizationSection["key"]>().toEqualTypeOf<string>();
  });

  test("RequestContext gains organizationId and skipGuards", () => {
    expectTypeOf<RequestContext["organizationId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RequestContext["skipGuards"]>().toEqualTypeOf<boolean | undefined>();
  });

  test("0.3.2 options: emptyModules, hooks, canManageMember, activeOrganization", () => {
    expectTypeOf<TenancyOptions["emptyModules"]>().toEqualTypeOf<"all" | "none" | undefined>();
    expectTypeOf<MemberEvent["before"]>().toEqualTypeOf<MembershipRecord | null>();
    expectTypeOf<MemberEvent["action"]>().toEqualTypeOf<
      "invite" | "accept" | "update" | "remove"
    >();
    expectTypeOf<MemberHooks["onRoleChange"]>().toEqualTypeOf<MemberHook | undefined>();
    expectTypeOf<ManageMemberArgs["action"]>().toEqualTypeOf<"invite" | "update" | "remove">();
    expectTypeOf<ReturnType<CanManageMember>>().toEqualTypeOf<boolean | Promise<boolean>>();
    expectTypeOf<TenancyOptions["activeOrganization"]>().toEqualTypeOf<
      ((req: Request) => string | null | undefined) | undefined
    >();
    expectTypeOf<MemberModules>().toEqualTypeOf<readonly string[] | "all">();
    expectTypeOf<MembershipPatch["modules"]>().toEqualTypeOf<MemberModules | undefined>();
    expectTypeOf(organizationFromPath("/t/:organization")).returns.toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<TenancyAdminOptions["organizationHref"]>().toEqualTypeOf<
      ((organizationId: string) => string) | undefined
    >();
  });
});
