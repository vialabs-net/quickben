import type { Quickben, RequestContext } from "@quickben/core";

const system: RequestContext = { user: null, overrideAccess: true };

/** Create a demo author and two posts when the database has no posts yet. */
export async function seedIfEmpty(qb: Quickben): Promise<void> {
  if ((await qb.count("posts", {}, system)) > 0) return;
  await qb.transaction(async (tx) => {
    const author = await tx.create(
      "authors",
      { name: "Ada Lovelace", email: "ada@example.com" },
      system,
    );
    await tx.create(
      "posts",
      {
        title: "Hello, Quickben",
        status: "published",
        publishedAt: new Date().toISOString(),
        author: author.id,
        body: "This post was created by lib/seed.ts. Edit or delete it in the admin.",
      },
      system,
    );
    await tx.create(
      "posts",
      { title: "A draft", author: author.id, body: "Anonymous visitors do not see drafts." },
      system,
    );
  });
}
