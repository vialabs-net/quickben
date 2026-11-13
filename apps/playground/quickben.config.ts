import { defineCollection, defineConfig, definePlugin, fields as f } from "@quickben/core";
import { connections } from "@quickben/plugin-connections";
import { tenancy } from "@quickben/plugin-tenancy";

import { playgroundAuth } from "./lib/auth";
import { connectionsEnabled, demoMasterKey } from "./lib/connections";
import { createDb } from "./lib/db";
import { seedIfEmpty } from "./lib/seed";
import { tenancyEnabled } from "./lib/tenancy";

import type { AccessArgs } from "@quickben/core";

const hasRole =
  (...roles: string[]) =>
  ({ user }: AccessArgs) =>
    user?.roles?.some((role) => roles.includes(role)) ?? false;

const canEdit = hasRole("admin", "editor");
const isAdmin = hasRole("admin");

export const authors = defineCollection({
  slug: "authors",
  fields: {
    name: f.text({ required: true, maxLength: 120 }),
    email: f.email({ unique: true }),
    bio: f.textarea({ maxLength: 2000 }),
    active: f.boolean({ default: true }),
  },
  access: { read: () => true, create: canEdit, update: canEdit, delete: isAdmin },
  admin: { useAsTitle: "name", defaultColumns: ["name", "email", "active", "updatedAt"] },
});

export const tags = defineCollection({
  slug: "tags",
  fields: {
    name: f.text({ required: true, unique: true, maxLength: 60 }),
    color: f.select({ options: ["gray", "blue", "green", "amber", "red"], default: "gray" }),
  },
  access: { read: () => true, create: canEdit, update: canEdit, delete: canEdit },
  admin: { useAsTitle: "name" },
});

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    slug: f.text({
      unique: true,
      maxLength: 200,
      description: "Lowercase letters, digits and dashes.",
      validate: (value) =>
        /^[a-z\d]+(?:-[a-z\d]+)*$/.test(value) || "Use lowercase letters, digits and dashes",
      admin: { width: "half" },
    }),
    status: f.select({
      options: ["draft", "review", "published"],
      required: true,
      default: "draft",
      admin: { width: "third" },
    }),
    author: f.relation({ to: "authors", admin: { width: "third" } }),
    publishedAt: f.datetime({ admin: { width: "third" } }),
    tags: f.relation({ to: "tags", many: true }),
    featured: f.boolean({ default: false }),
    body: f.textarea(),
  },
  access: {
    // Anonymous visitors see published posts only.
    read: ({ user }) => (user ? true : { status: { eq: "published" as const } }),
    create: canEdit,
    update: canEdit,
    delete: isAdmin,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "tags", "publishedAt"],
    description: "Articles shown on the public page once published.",
  },
});

export const settings = defineCollection({
  slug: "settings",
  fields: {
    key: f.text({ required: true, unique: true }),
    value: f.json({ required: true, description: "Any JSON value." }),
    description: f.text(),
  },
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
  admin: { useAsTitle: "key", defaultColumns: ["key", "value", "description"] },
});

const demo = definePlugin({
  name: "playground",
  modules: [
    { key: "content", label: "Content", collections: ["posts", "authors", "tags"] },
    { key: "system", label: "System", collections: ["settings"] },
  ],
  onInit: seedIfEmpty,
});

// With QUICKBEN_TENANCY=1, posts, authors and tags belong to an organization. The demo `admin`
// user is platform staff: it sees every organization.
const multiTenant = tenancy({
  scope: ["posts", "authors", "tags"],
  isPlatformAdmin: (user) => user.roles?.includes("admin") === true,
});

// With QUICKBEN_CONNECTIONS=1, the admin gets Integrations: connections and credentials.
const integrations = connections({ masterKey: demoMasterKey });

const config = defineConfig({
  db: createDb(),
  collections: [authors, tags, posts, settings],
  plugins: [
    demo,
    ...(tenancyEnabled ? [multiTenant] : []),
    ...(connectionsEnabled ? [integrations] : []),
  ],
  auth: playgroundAuth(),
  admin: { title: "Quickben Playground" },
});

export default config;
