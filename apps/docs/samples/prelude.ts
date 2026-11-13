/**
 * Shared context for the code blocks in `content/`. `scripts/extract-samples.mjs` writes every
 * `ts` block to `samples/generated/` and `tsc` checks it. Blocks may use the globals declared
 * below (`config`, `qb`, `user`) without defining them.
 */
import { defineCollection, defineConfig, devAuth, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { z } from "zod";

import type { InferRegistry, Quickben, QuickbenUser } from "@quickben/core";

export const users = defineCollection({
  slug: "users",
  fields: {
    email: f.email({ required: true, unique: true }),
    name: f.text(),
    roles: f.select({ options: ["admin", "editor"], many: true }),
  },
});

export const tags = defineCollection({
  slug: "tags",
  fields: { name: f.text({ required: true, unique: true }) },
  access: { read: () => true },
});

export const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    author: f.relation({ to: "users" }),
    tags: f.relation({ to: "tags", many: true }),
    views: f.number({ integer: true, min: 0, default: 0 }),
    publishedAt: f.datetime(),
    meta: f.json({ schema: z.object({ noIndex: z.boolean() }) }),
  },
  access: {
    read: () => true,
    create: ({ user }) => user !== null,
    update: ({ user }) => (user ? { author: { eq: user.id } } : false),
    delete: ({ user }) => user?.roles?.includes("admin") === true,
  },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "publishedAt"] },
});

export const exampleConfig = defineConfig({
  db: memoryAdapter(),
  collections: [users, tags, posts],
  auth: devAuth(),
});

declare global {
  /** The example config: `users`, `tags` and `posts`. */
  const config: typeof exampleConfig;
  /** Local API of the example config. */
  const qb: Quickben<InferRegistry<typeof exampleConfig>>;
  /** A signed-in user. */
  const user: QuickbenUser;
  /** The incoming request, in route handler samples. */
  const req: Request;
}
