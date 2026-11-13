import type { Quickben, RequestContext } from "@quickben/core";

const system: RequestContext = { user: null, overrideAccess: true };

/** Fill the playground with demo data when it has no posts yet. */
export async function seedIfEmpty(qb: Quickben): Promise<void> {
  if ((await qb.count("posts", {}, system)) > 0) return;
  await seed(qb);
}

/** Create demo authors, tags, posts and settings. */
export async function seed(qb: Quickben): Promise<{ created: number }> {
  let created = 0;
  await qb.transaction(async (tx) => {
    const ada = await tx.create(
      "authors",
      { name: "Ada Lovelace", email: "ada@example.com", bio: "Writes about engines." },
      system,
    );
    const alan = await tx.create(
      "authors",
      { name: "Alan Turing", email: "alan@example.com" },
      system,
    );
    const grace = await tx.create(
      "authors",
      { name: "Grace Hopper", email: "grace@example.com", active: false },
      system,
    );
    const tagNames = [
      ["news", "blue"],
      ["guides", "green"],
      ["release", "amber"],
      ["internals", "gray"],
    ] as const;
    const tagIds: string[] = [];
    for (const [name, color] of tagNames) {
      tagIds.push((await tx.create("tags", { name, color }, system)).id);
    }
    const authorIds = [ada.id, alan.id, grace.id];
    const statuses = ["published", "draft", "review"] as const;
    const titles = [
      "Getting started with Quickben",
      "Access rules in practice",
      "Writing a database adapter",
      "Hooks and transactions",
      "Designing collections",
      "The local API",
      "Relations and depth",
      "Custom admin fields",
      "Release notes 0.1",
      "Plugins in ten minutes",
      "Querying with where",
      "Cursor pagination",
    ];
    for (const [index, title] of titles.entries()) {
      const status = statuses[index % statuses.length] ?? "draft";
      await tx.create(
        "posts",
        {
          title,
          slug: title
            .toLowerCase()
            .replaceAll(/[^a-z\d]+/g, "-")
            .replaceAll(/(^-|-$)/g, ""),
          status,
          author: authorIds[index % authorIds.length] ?? null,
          tags: [
            tagIds[index % tagIds.length] ?? "",
            tagIds[(index + 1) % tagIds.length] ?? "",
          ].filter(Boolean),
          featured: index % 4 === 0,
          publishedAt:
            status === "published" ? new Date(Date.UTC(2026, 9, 1 + index, 9)).toISOString() : null,
          body: `${title}. This is demo content created by the playground seed.`,
        },
        system,
      );
    }
    await tx.create(
      "settings",
      {
        key: "site",
        value: { name: "Quickben Playground", locale: "en" },
        description: "Site name and locale",
      },
      system,
    );
    await tx.create(
      "settings",
      { key: "features", value: { comments: false, newsletter: true } },
      system,
    );
    created = 3 + tagNames.length + titles.length + 2;
  });
  return { created };
}
