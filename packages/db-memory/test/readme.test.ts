import { defineCollection, defineConfig, devAuth, fields as f, getQuickben } from "@quickben/core";
import { expect, expectTypeOf, it } from "vitest";

import { memoryAdapter } from "../src";

// Mirrors the quick start in the root README.
it("runs the README quick start", async () => {
  const posts = defineCollection({
    slug: "posts",
    fields: {
      title: f.text({ required: true, maxLength: 200 }),
      status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    },
    access: { read: () => true, create: ({ user }) => user !== null },
  });

  const config = defineConfig({ db: memoryAdapter(), collections: [posts], auth: devAuth() });

  const qb = await getQuickben(config);
  const user = { id: "u1" };
  await qb.create("posts", { title: "Hello" }, { user });
  const page = await qb.find(
    "posts",
    { where: { status: { eq: "draft" } }, sort: "-createdAt" },
    { user },
  );

  expect(page.docs.map((doc) => doc.title)).toEqual(["Hello"]);
  expectTypeOf(page.docs[0]!.status).toEqualTypeOf<"draft" | "published">();
});
