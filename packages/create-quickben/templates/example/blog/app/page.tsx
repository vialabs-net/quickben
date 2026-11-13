import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";
import { Suspense } from "react";

import config from "@/quickben.config";

const appName = "{{name}}";

/**
 * Home page. The posts depend on the request, so they render inside `<Suspense>`: the rest
 * of the page is prerendered and the posts stream in.
 */
export default function Home() {
  return (
    <main className="home">
      <h1>{appName}</h1>
      <nav>
        <Link href="/admin">Admin</Link>
        <a href="/api/posts">REST API</a>
      </nav>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Posts />
      </Suspense>
    </main>
  );
}

/** Published posts, read with the local API in a server component. */
async function Posts() {
  const ctx = await getRequestContext(config);
  const qb = await getQuickben(config);
  const posts = await qb.find(
    "posts",
    { where: { status: { eq: "published" } }, sort: "-publishedAt", limit: 10, depth: 1 },
    ctx,
  );
  return (
    <>
      <p className="muted">Signed in as {ctx.user?.email ?? "an anonymous visitor"}.</p>
      <ul>
        {posts.docs.map((post) => (
          <li key={post.id}>
            <strong>{post.title}</strong>
            <p className="muted">
              {typeof post.author === "object" && post.author ? post.author.name : "Unknown author"}
              {post.publishedAt ? ` · ${post.publishedAt.slice(0, 10)}` : ""}
            </p>
            {post.body ? <p>{post.body}</p> : null}
          </li>
        ))}
      </ul>
      {posts.docs.length === 0 ? <p className="muted">No published posts yet.</p> : null}
    </>
  );
}
