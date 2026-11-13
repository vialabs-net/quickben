import { defineCollection, defineConfig, devAuth, fields as f } from "@quickben/core";
import { drizzleAdapter } from "@quickben/db-drizzle/postgres";
import { tenancy } from "@quickben/plugin-tenancy";

const users = defineCollection({
  slug: "users",
  fields: { email: f.email({ required: true, unique: true }) },
});

const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    status: f.select({ options: ["draft", "published"], default: "draft" }),
    author: f.relation({ to: "users" }),
    publishedAt: f.date(),
    meta: f.json(),
  },
  access: {
    read: () => true,
    create: ({ user }) => !!user,
    update: ({ user }) => (user ? { author: { eq: user.id } } : false),
    delete: ({ user }) => user?.roles?.includes("admin") === true,
  },
  hooks: { beforeChange: [({ data }) => data] },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "publishedAt"] },
});

export default defineConfig({
  db: drizzleAdapter({ url: process.env.DATABASE_URL }),
  collections: [users, posts],
  plugins: [tenancy({ scope: ["posts"] })],
  auth: devAuth(),
});
