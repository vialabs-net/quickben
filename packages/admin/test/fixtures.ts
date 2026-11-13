import { defineCollection, defineConfig, definePlugin, devAuth, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

import type { AccessArgs } from "@quickben/core";

const isAdmin = ({ user }: AccessArgs) => user?.roles?.includes("admin") ?? false;
const signedIn = ({ user }: AccessArgs) => user !== null;

export const authors = defineCollection({
  slug: "authors",
  fields: { name: f.text({ required: true }), active: f.boolean({ default: true }) },
  access: { read: () => true, create: signedIn, update: signedIn, delete: isAdmin },
  admin: { useAsTitle: "name" },
});

export const tags = defineCollection({
  slug: "tags",
  fields: { name: f.text({ required: true, unique: true }) },
  access: { read: () => true, create: signedIn, update: signedIn, delete: signedIn },
  admin: { useAsTitle: "name", group: "Taxonomy" },
});

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true, maxLength: 80 }),
    slug: f.text({ unique: true, description: "URL part." }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    channels: f.select({ options: ["web", "email"], many: true }),
    views: f.number({ integer: true, min: 0 }),
    rating: f.number(),
    featured: f.boolean(),
    publishedOn: f.date(),
    publishedAt: f.datetime(),
    contact: f.email(),
    website: f.url(),
    summary: f.textarea(),
    author: f.relation({ to: "authors" }),
    tags: f.relation({ to: "tags", many: true }),
    meta: f.json(),
    color: f.text({ admin: { component: "color" } }),
    internal: f.text({ admin: { hidden: true } }),
    locked: f.text({ admin: { readOnly: true } }),
  },
  access: {
    read: ({ user }) => (user ? true : { status: { eq: "published" as const } }),
    create: signedIn,
    update: signedIn,
    delete: isAdmin,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "featured", "createdAt"],
  },
});

export const secrets = defineCollection({
  slug: "secrets",
  fields: { value: f.json({ required: true }) },
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
});

export const logs = defineCollection({
  slug: "logs",
  fields: { line: f.text() },
  access: { read: () => true },
  admin: { hidden: true },
});

/** Readable as a list, but not by id. */
export const notes = defineCollection({
  slug: "notes",
  fields: { text: f.text() },
  access: { read: ({ id }) => id === undefined, create: signedIn },
  admin: { useAsTitle: "text" },
});

export function makeConfig() {
  return defineConfig({
    db: memoryAdapter(),
    collections: [authors, tags, posts, secrets, logs, notes],
    auth: devAuth(),
    admin: { title: "Test admin" },
    plugins: [
      definePlugin({
        name: "modules",
        modules: [
          { key: "content", label: "Content", collections: ["posts", "authors"] },
          {
            key: "vault",
            label: "Vault",
            collections: ["secrets"],
            nav: [
              { label: "Secrets", collection: "secrets" },
              { label: "Help", href: "https://example.com/help" },
            ],
          },
        ],
      }),
    ],
  });
}

export const admin = { id: "a1", roles: ["admin"] };
export const editor = { id: "e1", roles: ["editor"] };
