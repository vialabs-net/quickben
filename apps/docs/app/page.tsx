import Link from "next/link";

import { highlight, readSample } from "../lib/highlight";
import { site } from "../lib/site";

import styles from "./landing.module.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Quickben: business apps from one typed config" },
  description: site.description,
  alternates: { canonical: "/" },
};

const notes = [
  { line: 13, text: "Document, input and filter types are inferred from these fields." },
  {
    line: 23,
    text: "Access rules return true, false or a filter. Filters are AND-ed with every query.",
  },
  { line: 31, text: "Pick a database adapter. Your collections stay the same." },
  { line: 33, text: "Plugins are functions from config to config. They run in the order listed." },
] as const;

type Status = "Available" | "Coming in 0.1" | "Planned";

const features: { title: string; text: string; code: string; status: Status; href: string }[] = [
  {
    title: "Typed collections",
    text: "Document, create, update and filter types come from the field definitions. No code generation.",
    code: "type Post = InferDoc<typeof posts>;",
    status: "Available",
    href: "/docs/concepts/collections",
  },
  {
    title: "Access rules that return filters",
    text: "A rule returns true, false or a where filter. Reads AND the filter with the query. Writes must match it.",
    code: "update: ({ user }) => ({ author: { eq: user.id } })",
    status: "Available",
    href: "/docs/concepts/access-control",
  },
  {
    title: "Database adapters",
    text: "One small adapter interface with a portable query model. In-memory today. Drizzle for Postgres, PGlite and SQLite next.",
    code: 'db: drizzleAdapter({ dialect: "pglite" })',
    status: "Coming in 0.1",
    href: "/docs/database-adapters/memory",
  },
  {
    title: "Two files in your Next.js app",
    text: "A catch-all route handler for REST and a catch-all page for the admin. Server components and server actions.",
    code: "app/api/[...quickben]/route.ts\napp/admin/[[...segments]]/page.tsx",
    status: "Coming in 0.1",
    href: "/docs/nextjs/route-handlers",
  },
  {
    title: "Admin generated from config",
    text: "List, create and edit screens from your fields. The sidebar comes from collections and modules.",
    code: 'admin: { useAsTitle: "title" }',
    status: "Coming in 0.1",
    href: "/docs/nextjs/admin",
  },
  {
    title: "Plugins, including multi-tenancy",
    text: "A plugin adds collections, hooks and modules. The tenancy plugin adds organizations, memberships and scoped access.",
    code: 'plugins: [tenancy({ scope: ["posts"] })]',
    status: "Planned",
    href: "/docs/concepts/plugins-and-modules",
  },
];

const steps = [
  {
    title: "Declare",
    text: "Collections, fields, access rules and hooks in quickben.config.ts.",
    code: "defineConfig({ db, collections })",
  },
  {
    title: "Call the local API",
    text: "Typed reads and writes on the server. Access and hooks run on every call.",
    code: 'await qb.find("posts", { where }, { user })',
  },
  {
    title: "Serve REST and the admin",
    text: "Route handlers and admin pages call the same local API.",
    code: "createRouteHandlers(config)\ncreateAdminPage(config)",
  },
] as const;

const packages: { name: string; status: Status }[] = [
  { name: "@quickben/core", status: "Available" },
  { name: "@quickben/db-memory", status: "Available" },
  { name: "@quickben/db-drizzle", status: "Coming in 0.1" },
  { name: "@quickben/next", status: "Coming in 0.1" },
  { name: "@quickben/admin", status: "Coming in 0.1" },
  { name: "@quickben/plugin-tenancy", status: "Planned" },
];

const statusClass: Record<Status, string | undefined> = {
  Available: styles.statusAvailable,
  "Coming in 0.1": styles.statusComing,
  Planned: styles.statusPlanned,
};

function StatusTag({ status }: Readonly<{ status: Status }>) {
  return <span className={`${styles.status ?? ""} ${statusClass[status] ?? ""}`}>{status}</span>;
}

export default async function LandingPage() {
  const code = await readSample("hero/quickben.config.ts");
  const highlighted = await highlight(
    code,
    Object.fromEntries(notes.map((n, i) => [n.line, i + 1])),
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroText}>
          <h1 id="hero-title" className={styles.title}>
            Business apps from one typed config.
          </h1>
          <p className={styles.lede}>
            Declare collections with fields, access rules and hooks. Quickben gives you a typed
            server API, REST routes and an admin UI on your own database. Built for the Next.js App
            Router.
          </p>
          <div className={styles.actions}>
            <Link href="/docs" className={styles.primary}>
              Read the docs
            </Link>
            <a href={site.repo} className={styles.secondary}>
              View on GitHub
            </a>
          </div>
          <ul className={styles.facts} aria-label="Project status">
            <li>Alpha</li>
            <li>Apache-2.0</li>
            <li>TypeScript, ESM, Node.js 22+</li>
          </ul>
        </div>

        <figure className={styles.specimen}>
          <figcaption className={styles.fileName}>quickben.config.ts</figcaption>
          <div className={styles.code}>{highlighted}</div>
          <ol className={styles.notes}>
            {notes.map((note) => (
              <li key={note.line}>{note.text}</li>
            ))}
          </ol>
        </figure>
      </section>

      <section className={styles.section} aria-labelledby="features-title">
        <h2 id="features-title" className={styles.h2}>
          What you get
        </h2>
        <dl className={styles.features}>
          {features.map((feature) => (
            <div key={feature.title} className={styles.feature}>
              <dt>
                <Link href={feature.href} className={styles.featureTitle}>
                  {feature.title}
                </Link>
                <StatusTag status={feature.status} />
              </dt>
              <dd>
                <p>{feature.text}</p>
                <pre className={styles.snippet}>
                  <code>{feature.code}</code>
                </pre>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="how-title">
        <h2 id="how-title" className={styles.h2}>
          How it works
        </h2>
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li key={step.title} className={styles.step}>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p>{step.text}</p>
              <pre className={styles.snippet}>
                <code>{step.code}</code>
              </pre>
            </li>
          ))}
        </ol>
      </section>

      <section
        className={`${styles.section ?? ""} ${styles.closing ?? ""}`}
        aria-labelledby="status-title"
      >
        <div>
          <h2 id="status-title" className={styles.h2}>
            Status
          </h2>
          <p className={styles.closingText}>
            Quickben is alpha. APIs can change before 1.0. The code is open on GitHub under
            Apache-2.0, built and maintained by{" "}
            <a href={site.vendor.url} className={styles.inlineLink}>
              {site.vendor.name}
            </a>
            .
          </p>
          <div className={styles.actions}>
            <Link href="/docs/quick-start" className={styles.primary}>
              Open the quick start
            </Link>
            <a href={site.repo} className={styles.secondary}>
              View on GitHub
            </a>
          </div>
        </div>
        <table className={styles.packages}>
          <caption className={styles.srOnly}>Package status</caption>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.name}>
                <td>
                  <code>{pkg.name}</code>
                </td>
                <td>
                  <StatusTag status={pkg.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
