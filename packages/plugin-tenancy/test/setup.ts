import { createQuickben, defineCollection, defineConfig, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

import { moduleAccess, tenancy } from "../src";

import type { TenancyOptions } from "../src";
import type { QuickbenUser, RequestContext } from "@quickben/core";

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    author: f.text(),
  },
  access: {
    // Everyone in the organization reads; only the author edits drafts.
    update: ({ user }) => (user ? { author: { eq: user.id } } : false),
  },
});

export const notes = defineCollection({
  slug: "notes",
  fields: { text: f.text({ required: true }) },
});

export const reports = defineCollection({
  slug: "reports",
  fields: { name: f.text({ required: true }) },
  access: moduleAccess("reports", { read: () => true }),
});

export const system: RequestContext = { user: null, overrideAccess: true };

export function makeConfig(options: Partial<TenancyOptions<"posts" | "notes">> = {}) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [posts, notes, reports],
    modules: [
      { key: "sales", label: "Sales", collections: ["posts"] },
      { key: "reports", label: "Reports", collections: ["reports"] },
    ],
    plugins: [tenancy({ scope: ["posts", "notes"], ...options })],
  });
}

export const alice: QuickbenUser = { id: "alice", email: "alice@example.com" };
export const bob: QuickbenUser = { id: "bob", email: "bob@example.com" };
export const carol: QuickbenUser = { id: "carol", email: "carol@example.com" };
export const dave: QuickbenUser = { id: "dave", email: "dave@example.com" };
export const staff: QuickbenUser = { id: "staff", roles: ["platform-admin"] };

/** A fresh context: tenant resolution is cached per context object. */
export const as = (
  user: QuickbenUser | null,
  extra: Partial<RequestContext> = {},
): RequestContext => ({
  user,
  ...extra,
});

/**
 * Two organizations. `acme`: alice owner, bob admin, carol member, dave viewer.
 * `globex`: bob owner.
 */
export async function setup(options: Partial<TenancyOptions<"posts" | "notes">> = {}) {
  const qb = await createQuickben(makeConfig(options));
  const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
  const globex = await qb.create("organizations", { name: "Globex", slug: "globex" }, as(bob));
  const member = (user: QuickbenUser, role: string, organization = acme.id) =>
    qb.create(
      "memberships",
      { organization, user: user.id, email: user.email ?? null, role, status: "active" },
      system,
    );
  const bobAtAcme = await member(bob, "admin");
  const carolAtAcme = await member(carol, "member");
  const daveAtAcme = await member(dave, "viewer");
  const [aliceAtAcme] = (await qb.find("memberships", { where: { user: { eq: "alice" } } }, system))
    .docs;
  return { qb, acme, globex, aliceAtAcme: aliceAtAcme!, bobAtAcme, carolAtAcme, daveAtAcme };
}

/** Context inside one organization. */
export const inOrg = (user: QuickbenUser, organizationId: string) => as(user, { organizationId });
