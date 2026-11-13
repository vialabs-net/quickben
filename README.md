# Quickben

Declare typed collections in one config and get a typed server API, access rules, hooks and plugins on your own database. Built for Next.js.

**Status: alpha.** APIs change without notice until 1.0. Docs: https://quickben.vialabs.net

## Quick start

```sh
pnpm create quickben my-app
cd my-app
pnpm dev
```

Then open http://localhost:3000/admin. The app uses PGlite, so no database server is needed. See [`create-quickben`](packages/create-quickben) for the options.

To add Quickben to code you already have:

```ts
import { defineCollection, defineConfig, devAuth, fields as f, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
  },
  access: { read: () => true, create: ({ user }) => user !== null },
});

export const config = defineConfig({ db: memoryAdapter(), collections: [posts], auth: devAuth() });

const qb = await getQuickben(config);
const user = { id: "u1" };
await qb.create("posts", { title: "Hello" }, { user });
const page = await qb.find(
  "posts",
  { where: { status: { eq: "draft" } }, sort: "-createdAt" },
  { user },
);
```

`page.docs` is typed from the fields: `{ id, createdAt, updatedAt, title: string, status: "draft" | "published" }[]`.

## Packages

| Package                                               | Description                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@quickben/core`](packages/core)                     | Config, fields, collections, access, hooks, plugins, local API, adapter contract. |
| [`@quickben/db-memory`](packages/db-memory)           | In-memory database adapter for tests and demos.                                   |
| [`@quickben/db-drizzle`](packages/db-drizzle)         | Drizzle ORM adapter: Postgres, PGlite and SQLite (libSQL).                        |
| [`@quickben/next`](packages/next)                     | Next.js REST route handlers and server helpers.                                   |
| [`@quickben/admin`](packages/admin)                   | Admin UI generated from collections.                                              |
| [`@quickben/plugin-tenancy`](packages/plugin-tenancy) | Multi-tenancy: organizations, memberships, roles, scoped collections.             |
| [`create-quickben`](packages/create-quickben)         | CLI that creates a Next.js app with Quickben.                                     |
| [`@quickben/adapter-tests`](packages/adapter-tests)   | Contract tests every database adapter must pass. Private.                         |

[`apps/playground`](apps/playground) uses everything: `pnpm dev`, then open http://localhost:3000/admin.

## Requirements

Node.js 22.18 or later. ESM only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## License

[Apache-2.0](LICENSE)
