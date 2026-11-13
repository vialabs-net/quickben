import { getQuickben, getRequestContext } from "@quickben/next";
import { Suspense } from "react";

import config from "@/quickben.config";

import { RoleBar, RoleBarFallback } from "./role-bar";

/**
 * Public page. The posts depend on the user, so they render inside `<Suspense>`: with
 * `cacheComponents` the rest of the page is prerendered and the posts stream in.
 */
export default function Home() {
  return (
    <>
      <Suspense fallback={<RoleBarFallback />}>
        <RoleBar />
      </Suspense>
      <main className="public">
        <h1>Published posts</h1>
        <Suspense fallback={<p className="lead">Loading posts…</p>}>
          <Posts />
        </Suspense>
      </main>
    </>
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
      <p className="lead">
        Read on the server with <code>qb.find(&quot;posts&quot;, …)</code> as{" "}
        <strong>{ctx.user?.email ?? "an anonymous visitor"}</strong>.
      </p>
      <ul className="posts">
        {posts.docs.map((post) => (
          <li key={post.id}>
            <h2>{post.title}</h2>
            <p className="meta">
              {typeof post.author === "object" && post.author ? post.author.name : "Unknown author"}
              {post.publishedAt ? ` · ${post.publishedAt.slice(0, 10)}` : ""}
            </p>
            {post.body ? <p>{post.body}</p> : null}
          </li>
        ))}
      </ul>
      {posts.docs.length === 0 ? <p>No published posts yet.</p> : null}
    </>
  );
}
