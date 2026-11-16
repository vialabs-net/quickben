import { endpointFactory, NotFoundError, reply } from "@quickben/core";
import { z } from "zod";

import type { authors, posts, settings, tags } from "@/quickben.config";
import type { ConfigRegistry } from "@quickben/core";

/** `qb` typed with the playground collections. */
const defineEndpoint =
  endpointFactory<
    ConfigRegistry<typeof authors | typeof tags | typeof posts | typeof settings, never>
  >();

const hasRole = (user: { roles?: string[] } | null, ...roles: string[]) =>
  user?.roles?.some((role) => roles.includes(role)) ?? false;

/** Public read: `GET /api/v1/posts/published?limit=5`. Anyone may call it. */
export const publishedPosts = defineEndpoint({
  method: "GET",
  path: "/posts/published",
  version: 1,
  summary: "List published posts",
  tags: ["posts"],
  access: true,
  input: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) },
  output: z.object({
    posts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        slug: z.string().nullable(),
        publishedAt: z.string().nullable(),
      }),
    ),
  }),
  handler: async ({ input, qb, ctx }) => {
    const found = await qb.find(
      "posts",
      {
        where: { status: { eq: "published" } },
        sort: "-publishedAt",
        limit: input.query.limit,
        select: ["title", "slug", "publishedAt"],
      },
      ctx,
    );
    return { posts: found.docs };
  },
});

// The memory-backed demo runs in one process. Keep the read/merge/write and commit
// together so concurrent publications of the same post retain both sets of tags.
const publications = new Map<string, Promise<void>>();

async function serializePublication<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = publications.get(id);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  publications.set(id, pending);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (publications.get(id) === pending) publications.delete(id);
  }
}

/**
 * Authenticated write in one transaction: `POST /api/v1/posts/:id/publish` with
 * `{ "tags": ["news"] }` creates the missing tags, attaches them and publishes the post.
 * If any step fails, nothing is written.
 */
export const publishPost = defineEndpoint({
  method: "POST",
  path: "/posts/:id/publish",
  version: 1,
  summary: "Publish a post and tag it",
  tags: ["posts"],
  access: ({ user }) => hasRole(user, "admin", "editor"),
  input: {
    body: z.object({ tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]) }),
  },
  output: {
    200: z.object({ id: z.string(), status: z.literal("published"), tags: z.array(z.string()) }),
    404: z.object({ error: z.object({ code: z.literal("NOT_FOUND"), message: z.string() }) }),
  },
  handler: async ({ input, qb, ctx }) =>
    serializePublication(input.params.id, () =>
      qb.transaction(async (qb) => {
        let post;
        try {
          post = await qb.findById("posts", input.params.id, {}, ctx);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
          return reply(404, { error: { code: "NOT_FOUND" as const, message: "No such post" } });
        }
        const tagIds = new Set(post.tags);
        for (const name of input.body.tags) {
          const existing = await qb.find("tags", { where: { name: { eq: name } }, limit: 1 }, ctx);
          const tag = existing.docs[0] ?? (await qb.create("tags", { name }, ctx));
          tagIds.add(tag.id);
        }
        const updated = await qb.update(
          "posts",
          post.id,
          {
            status: "published",
            publishedAt: post.publishedAt ?? new Date(),
            tags: [...tagIds],
          },
          ctx,
        );
        return reply(200, { id: updated.id, status: "published" as const, tags: updated.tags });
      }),
    ),
});

export const playgroundEndpoints = [publishedPosts, publishPost];
