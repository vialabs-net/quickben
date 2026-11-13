import { defineCollection, defineConfig, fields as f } from "@quickben/core";

import type { DatabaseAdapter } from "@quickben/core";

const open = { read: () => true, create: () => true, update: () => true, delete: () => true };

export const tags = defineCollection({
  slug: "tags",
  fields: { label: f.text({ required: true }) },
  access: open,
});

export const authors = defineCollection({
  slug: "authors",
  fields: {
    name: f.text({ required: true }),
    email: f.email({ unique: true }),
    favoriteTag: f.relation({ to: "tags" }),
  },
  access: open,
});

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true }),
    slug: f.text({ unique: true }),
    body: f.textarea(),
    views: f.number({ integer: true }),
    rating: f.number(),
    published: f.boolean(),
    status: f.select({ options: ["draft", "published", "archived"] }),
    categories: f.select({ options: ["news", "tech", "life"], many: true }),
    publishedOn: f.date(),
    publishedAt: f.datetime(),
    author: f.relation({ to: "authors" }),
    tags: f.relation({ to: "tags", many: true }),
    meta: f.json(),
  },
  access: open,
});

export const logs = defineCollection({
  slug: "logs",
  fields: { message: f.text({ required: true }) },
  access: open,
  hooks: {
    afterChange: [
      ({ doc }) => {
        if (doc.message === "fail") throw new Error("afterChange failed");
      },
    ],
  },
});

/** Config used by the contract suite. */
export function contractConfig(db: DatabaseAdapter) {
  return defineConfig({ db, collections: [tags, authors, posts, logs] });
}
