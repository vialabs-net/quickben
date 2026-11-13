import { z } from "zod";

import { defineCollection, defineConfig, fields as f } from "../src";

import type { DatabaseAdapter } from "../src";

export const users = defineCollection({
  slug: "users",
  fields: {
    name: f.text({ required: true }),
    email: f.email({ required: true, unique: true }),
    role: f.select({ options: ["admin", "editor"], required: true, default: "editor" }),
  },
  access: { read: () => true },
});

export const tags = defineCollection({
  slug: "tags",
  fields: { label: f.text({ required: true }) },
  access: { read: () => true, create: () => true },
});

export const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    body: f.textarea(),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    categories: f.select({ options: ["news", "tech", "life"], many: true }),
    author: f.relation({ to: "users" }),
    tags: f.relation({ to: "tags", many: true }),
    views: f.number({ integer: true, min: 0 }),
    featured: f.boolean({ default: false }),
    publishedOn: f.date(),
    publishedAt: f.datetime(),
    website: f.url(),
    meta: f.json(),
    seo: f.json({ schema: z.object({ title: z.string(), noIndex: z.boolean() }) }),
  },
  access: {
    read: () => true,
    create: ({ user }) => user !== null,
    update: ({ user }) => (user ? { author: { eq: user.id } } : false),
    delete: ({ user }) => user?.roles?.includes("admin") ?? false,
  },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "publishedAt"] },
});

/** Build a config around any adapter. */
export function makeConfig(db: DatabaseAdapter) {
  return defineConfig({ db, collections: [users, tags, posts] });
}
