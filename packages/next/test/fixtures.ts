import { defineCollection, defineConfig, definePlugin, devAuth, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

const isAdmin = ({ user }: { user: { roles?: string[] } | null }) =>
  user?.roles?.includes("admin") ?? false;

export const authors = defineCollection({
  slug: "authors",
  fields: { name: f.text({ required: true }) },
  access: { read: () => true },
  admin: { useAsTitle: "name" },
});

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true, maxLength: 50 }),
    slug: f.text({ unique: true }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    views: f.number({ integer: true, min: 0 }),
    author: f.relation({ to: "authors" }),
    createdBy: f.text({ default: () => "system" }),
  },
  access: {
    read: ({ user }) => (user ? true : { status: { eq: "published" as const } }),
    delete: isAdmin,
  },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status"], group: "Content" },
});

export const secrets = defineCollection({
  slug: "secrets",
  fields: { value: f.text() },
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
});

export function makeConfig() {
  return defineConfig({
    db: memoryAdapter(),
    collections: [authors, posts, secrets],
    auth: devAuth(),
    admin: { title: "Test" },
    plugins: [
      definePlugin({
        name: "modules",
        modules: [
          {
            key: "content",
            label: "Content",
            collections: ["posts", "authors"],
            nav: [
              { label: "Posts", collection: "posts" },
              { label: "Secrets", collection: "secrets" },
              { label: "Docs", href: "https://example.com" },
            ],
          },
          { key: "vault", label: "Vault", collections: ["secrets"] },
        ],
      }),
    ],
  });
}

export const admin = JSON.stringify({ id: "a1", roles: ["admin"] });
export const editor = JSON.stringify({ id: "e1", roles: ["editor"] });

/** Build a request to the API. */
export function request(
  method: string,
  path: string,
  options: { user?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...options.headers };
  if (options.user) headers["x-quickben-user"] = options.user;
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers["content-type"] ??= "application/json";
  }
  return new Request(`http://localhost:3000${path}`, { method, headers, body });
}
