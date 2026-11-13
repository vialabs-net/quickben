import { getQuickben } from "@quickben/core";
import { describe, expectTypeOf, test } from "vitest";

import { listMyOrganizations, resolveTenant, switchOrganization } from "../src";

import type { MyOrganization, SwitchResult, Tenant } from "../src";
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
    expectTypeOf<Org["status"]>().toEqualTypeOf<"active" | "suspended">();
    expectTypeOf<Org["modules"]>().toEqualTypeOf<string[]>();
    type Membership = InferDoc<R["memberships"]>;
    expectTypeOf<Membership["status"]>().toEqualTypeOf<"invited" | "active" | "disabled">();
    expectTypeOf<Membership["user"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InferCreateInput<R["organizations"]>["modules"]>().toEqualTypeOf<
      string[] | undefined
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

  test("RequestContext gains organizationId", () => {
    expectTypeOf<RequestContext["organizationId"]>().toEqualTypeOf<string | undefined>();
  });
});
