import { defineCollection, defineConfig, defineEndpoint, fields, reply } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { z } from "zod";

import type { AuthAdapter } from "@quickben/core";

export const Tag = z
  .object({ name: z.string(), color: z.enum(["gray", "blue"]).default("gray") })
  .meta({ id: "Tag", description: "A tag." });

export const authors = defineCollection({
  slug: "authors",
  fields: {
    name: fields.text({ required: true, maxLength: 120 }),
    email: fields.email({ unique: true, access: { read: () => false } }),
    site: fields.url(),
    photo: fields.file({ accept: ["image/png"], maxBytes: 1024 }),
  },
  api: { openapi: true },
});

export const posts = defineCollection({
  slug: "posts",
  labels: { plural: { en: "Posts", es: "Entradas" } },
  fields: {
    title: fields.text({ required: true, label: "Title", description: "Shown in lists." }),
    status: fields.select({ options: ["draft", "published"], required: true, default: "draft" }),
    views: fields.number({ integer: true, min: 0 }),
    rating: fields.number({ min: 0, max: 5 }),
    featured: fields.boolean(),
    publishedOn: fields.date(),
    publishedAt: fields.datetime(),
    author: fields.relation({ to: "authors" }),
    reviewer: fields.relation({ to: "users" }),
    tags: fields.relation({ to: "authors", many: true }),
    labels: fields.select({ options: ["a", "b"], many: true }),
    meta: fields.json({ schema: z.object({ seo: z.string().optional() }) }),
    extra: fields.json(),
    body: fields.textarea({ minLength: 1 }),
  },
  admin: { description: "Articles." },
  api: { openapi: true },
});

/** Not marked for the API. */
export const users = defineCollection({
  slug: "users",
  fields: { name: fields.text() },
});

export const listTags = defineEndpoint({
  method: "GET",
  path: "/tags",
  version: 1,
  summary: "List tags",
  description: "Every tag.",
  tags: ["tags"],
  access: true,
  input: {
    query: z.object({
      limit: z.coerce.number().int().min(1).describe("Largest number of tags.").default(10),
      q: z.string().optional(),
      kind: z.array(z.string()).optional(),
    }),
  },
  output: z.object({ tags: z.array(Tag) }),
  handler: () => ({ tags: [] }),
});

export const createTag = defineEndpoint({
  method: "POST",
  path: "/tags",
  version: 1,
  operationId: "createTag",
  input: { body: Tag },
  output: { 201: Tag, 409: z.object({ taken: z.literal(true) }) },
  deprecated: "2026-01-01",
  sunset: new Date("2027-01-01T00:00:00Z"),
  handler: ({ input }) => reply(201, input.body),
});

export const tagById = defineEndpoint({
  method: "PUT",
  path: "/tags/:id",
  input: {
    params: z.object({ id: z.uuid().describe("Tag id.") }),
    body: z.object({ name: z.string() }).optional(),
  },
  deprecated: true,
  handler: () => undefined,
});

export const ping = defineEndpoint({
  method: "DELETE",
  path: "/ping/:token",
  handler: () => new Response(null, { status: 204 }),
});

export const auth: AuthAdapter = {
  getUser: () => Promise.resolve(null),
  securitySchemes: {
    session: { type: "apiKey", in: "cookie", name: "sid" },
    bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
  },
};

export function fixtureConfig(options: { auth?: AuthAdapter } = {}) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [authors, posts, users],
    endpoints: [listTags, createTag, tagById, ping],
    auth: options.auth ?? auth,
    admin: { title: "Fixture" },
  });
}
