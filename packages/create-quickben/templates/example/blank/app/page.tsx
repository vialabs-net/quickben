import { getQuickben, getRequestContext } from "@quickben/next";
import Link from "next/link";

import config from "@/quickben.config";

const appName = "{{name}}";

// Read the database on every request, never at build time.
export const dynamic = "force-dynamic";

/** Home page: the latest notes, read with the local API in a server component. */
export default async function Home() {
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const notes = await qb.find("notes", { sort: "-createdAt", limit: 10 }, ctx);
  return (
    <main className="home">
      <h1>{appName}</h1>
      <p className="muted">Signed in as {ctx.user?.email ?? "an anonymous visitor"}.</p>
      <nav>
        <Link href="/admin">Admin</Link>
        <a href="/api/notes">REST API</a>
      </nav>
      <ul>
        {notes.docs.map((note) => (
          <li key={note.id}>
            <strong>{note.title}</strong>
            {note.body ? <p>{note.body}</p> : null}
          </li>
        ))}
      </ul>
      {notes.docs.length === 0 ? (
        <p className="muted">
          No notes yet. <Link href="/admin/notes/new">Create one in the admin.</Link>
        </p>
      ) : null}
    </main>
  );
}
