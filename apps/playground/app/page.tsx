import { QuickbenError } from "@quickben/core";
import { getQuickben, getRequestContext } from "@quickben/next";

import config from "@/quickben.config";

import { RoleBar } from "./role-bar";

/** Public page: published posts, read with the local API in a server component. */
export default async function Home() {
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  let posts;
  try {
    posts = await qb.find(
      "posts",
      { where: { status: { eq: "published" } }, sort: "-publishedAt", limit: 10, depth: 1 },
      ctx,
    );
  } catch (error) {
    // With tenancy on, posts belong to an organization: anonymous visitors and users with
    // several organizations get an access error here.
    if (!(error instanceof QuickbenError)) throw error;
    return (
      <>
        <RoleBar />
        <main className="public">
          <h1>Published posts</h1>
          <p className="lead">{error.message}</p>
        </main>
      </>
    );
  }
  return (
    <>
      <RoleBar />
      <main className="public">
        <h1>Published posts</h1>
        <p className="lead">
          Read on the server with <code>qb.find(&quot;posts&quot;, …)</code> as{" "}
          <strong>{ctx.user?.email ?? "an anonymous visitor"}</strong>.
        </p>
        <ul className="posts">
          {posts.docs.map((post) => (
            <li key={post.id}>
              <h2>{post.title}</h2>
              <p className="meta">
                {typeof post.author === "object" && post.author
                  ? post.author.name
                  : "Unknown author"}
                {post.publishedAt ? ` · ${post.publishedAt.slice(0, 10)}` : ""}
              </p>
              {post.body ? <p>{post.body}</p> : null}
            </li>
          ))}
        </ul>
        {posts.docs.length === 0 ? <p>No published posts yet.</p> : null}
      </main>
    </>
  );
}
