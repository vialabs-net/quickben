import { getQuickben, getRequestContext } from "@quickben/next";
import Link from "next/link";

import config from "@/quickben.config";

const appName = "{{name}}";

// Read the database on every request, never at build time.
export const dynamic = "force-dynamic";

/** Home page: published posts, read with the local API in a server component. */
export default async function Home() {
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const posts = await qb.find(
    "posts",
    { where: { status: { eq: "published" } }, sort: "-publishedAt", limit: 10, depth: 1 },
    ctx,
  );
  return (
    <main className="home">
      <h1>{appName}</h1>
      <p className="muted">Signed in as {ctx.user?.email ?? "an anonymous visitor"}.</p>
      <nav>
        <Link href="/admin">Admin</Link>
        <a href="/api/posts">REST API</a>
      </nav>
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
    </main>
  );
}
