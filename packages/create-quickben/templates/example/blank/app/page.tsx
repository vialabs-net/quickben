import { getQuickben, getRequestContext } from "@quickben/next";
import Link from "next/link";
import { Suspense } from "react";

import config from "@/quickben.config";

const appName = "{{name}}";

/**
 * Home page. The notes depend on the request, so they render inside `<Suspense>`: the rest
 * of the page is prerendered and the notes stream in.
 */
export default function Home() {
  return (
    <main className="home">
      <h1>{appName}</h1>
      <nav>
        <Link href="/admin">Admin</Link>
        <a href="/api/notes">REST API</a>
      </nav>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Notes />
      </Suspense>
    </main>
  );
}

/** The latest notes, read with the local API in a server component. */
async function Notes() {
  const ctx = await getRequestContext(config);
  const qb = await getQuickben(config);
  const notes = await qb.find("notes", { sort: "-createdAt", limit: 10 }, ctx);
  return (
    <>
      <p className="muted">Signed in as {ctx.user?.email ?? "an anonymous visitor"}.</p>
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
    </>
  );
}
