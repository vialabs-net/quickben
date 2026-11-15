import { expect, test } from "@playwright/test";

// Custom endpoints of lib/endpoints.ts, over HTTP. The demo auth reads `x-quickben-user`.
test.skip(
  process.env.QUICKBEN_TENANCY === "1" || process.env.QUICKBEN_AUTH === "better-auth",
  "single-tenant playground with the demo auth only",
);

const editor = { "x-quickben-user": JSON.stringify({ id: "editor", roles: ["editor"] }) };
// Without a header the demo auth reads the role cookie, and defaults to admin.
const anonymous = { cookie: "qb-playground-role=anonymous" };
const viewer = { "x-quickben-user": JSON.stringify({ id: "viewer", roles: ["viewer"] }) };

interface Post {
  id: string;
  title: string;
  status: string;
  tags: string[];
}

test("public read endpoint lists published posts", async ({ request }) => {
  const response = await request.get("/api/v1/posts/published?limit=2");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const { posts } = (await response.json()) as { posts: { id: string; title: string }[] };
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.length).toBeLessThanOrEqual(2);
  expect(Object.keys(posts[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    "id",
    "publishedAt",
    "slug",
    "title",
  ]);

  const invalid = await request.get("/api/v1/posts/published?limit=500");
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({
    error: { code: "VALIDATION", details: { issues: [{ path: "query.limit" }] } },
  });
});

test("authenticated write endpoint publishes and tags a post in one transaction", async ({
  request,
}) => {
  const created = await request.post("/api/posts", {
    headers: editor,
    data: { title: `Endpoint post ${String(Date.now())}` },
  });
  expect(created.status()).toBe(201);
  const post = (await created.json()) as Post;
  const name = `endpoint-${String(Date.now())}`;
  const path = `/api/v1/posts/${post.id}/publish`;

  expect((await request.post(path, { headers: anonymous, data: { tags: [name] } })).status()).toBe(
    401,
  );
  expect((await request.post(path, { headers: viewer, data: { tags: [name] } })).status()).toBe(
    403,
  );
  const crossSite = await request.post(path, {
    headers: { ...editor, origin: "https://evil.example" },
    data: { tags: [name] },
  });
  expect(crossSite.status()).toBe(403);

  // A tag name over 60 characters fails validation before anything is written.
  const tooLong = await request.post(path, { headers: editor, data: { tags: ["x".repeat(61)] } });
  expect(tooLong.status()).toBe(400);

  const published = await request.post(path, { headers: editor, data: { tags: [name] } });
  expect(published.status()).toBe(200);
  const body = (await published.json()) as { id: string; status: string; tags: string[] };
  expect(body).toMatchObject({ id: post.id, status: "published" });
  expect(body.tags).toHaveLength(1);

  const stored = (await (await request.get(`/api/posts/${post.id}`)).json()) as Post;
  expect(stored.status).toBe("published");
  const tag = await request.get(`/api/tags/${body.tags[0] ?? ""}`);
  expect(await tag.json()).toMatchObject({ name });

  const missing = await request.post("/api/v1/posts/missing/publish", {
    headers: editor,
    data: {},
  });
  expect(missing.status()).toBe(404);
  expect((await request.put("/api/v1/posts/published")).status()).toBe(405);
});
