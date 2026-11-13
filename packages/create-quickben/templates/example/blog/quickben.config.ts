import { defineCollection, defineConfig, definePlugin, fields as f } from "@quickben/core";

import { appAuth } from "./lib/auth";
import { createDb } from "./lib/db";
import { seedIfEmpty } from "./lib/seed";

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
  },
  access: { read: () => true, create: canEdit, update: canEdit, delete: isAdmin },
  admin: { useAsTitle: "name", defaultColumns: ["name", "email", "updatedAt"] },
});

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    status: f.select({
      options: ["draft", "published"],
      required: true,
      default: "draft",
      admin: { width: "half" },
    }),
    publishedAt: f.datetime({ admin: { width: "half" } }),
    author: f.relation({ to: "authors" }),
    body: f.textarea(),
  },
  access: {
    // Anonymous visitors see published posts only.
    read: ({ user }) => (user ? true : { status: { eq: "published" as const } }),
    create: canEdit,
    update: canEdit,
    delete: isAdmin,
  },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "author", "publishedAt"] },
});

const blog = definePlugin({
  name: "blog",
  modules: [{ key: "content", label: "Content", collections: ["posts", "authors"] }],
  onInit: seedIfEmpty,
});

const config = defineConfig({
  db: createDb(),
  collections: [authors, posts],
  plugins: [blog],
  auth: appAuth(),
  admin: { title: "{{name}}" },
});

export default config;
