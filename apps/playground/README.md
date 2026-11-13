# Quickben playground

A Next.js app that uses Quickben end to end. No external services.

```sh
pnpm install
pnpm dev          # builds the packages, then http://localhost:3000
```

| Path         | What                                                   |
| ------------ | ------------------------------------------------------ |
| `/`          | Public page: published posts, read with the local API. |
| `/admin`     | Admin UI.                                              |
| `/api/_meta` | REST API (`/api/posts`, `/api/posts/:id`, …).          |

| File                                 | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `quickben.config.ts`                 | Collections: authors, tags, posts, settings. |
| `app/api/[...quickben]/route.ts`     | REST handlers.                               |
| `app/admin/[[...segments]]/page.tsx` | Admin page and its server function.          |
| `lib/db.ts`                          | Database choice.                             |
| `lib/auth.ts`                        | `devAuth()` with a role cookie.              |

## Database

| `QUICKBEN_DB`      | Storage                                             |
| ------------------ | --------------------------------------------------- |
| `pglite` (default) | PGlite in `./.pglite`. Tables are created on start. |
| `memory`           | In memory. Resets on restart.                       |

An empty database is seeded on start. `pnpm seed` seeds it from the command line, `pnpm db:reset` deletes `./.pglite`.

## Multi-tenancy

Start with `QUICKBEN_TENANCY=1` (or `pnpm dev:tenancy`) to add `@quickben/plugin-tenancy`. Posts, authors and tags then belong to an organization. PGlite data goes to `./.pglite-tenancy`.

| Demo user | Organizations                         |
| --------- | ------------------------------------- |
| admin     | Platform staff: every organization.   |
| editor    | Owner of Acme, admin of Globex.       |
| viewer    | Viewer in Acme.                       |
| anonymous | None. The public page shows an error. |

The admin gets an organization switcher in the sidebar, a Members page and an Organization settings page. `e2e/tenancy.spec.ts` runs only in this mode.

## Document reading

Start with `QUICKBEN_DOC_READER=1` (or `pnpm dev:doc-reader`) to add `@quickben/plugin-doc-reader` with a fake vision model: no API key, no network. The admin gets Document types, Readings and Usage pages. Files go to `./.doc-reader-files`. `e2e/doc-reader.spec.ts` runs only in this mode.

## Better Auth

Start with `QUICKBEN_AUTH=better-auth` (or `pnpm dev:better-auth`) to sign in with `@quickben/auth-better-auth` instead of the role switcher. Users are stored in SQLite (`node:sqlite`) in `./.better-auth.sqlite`, or in memory with `QUICKBEN_DB=memory`.

| Account              | Password              | Role   |
| -------------------- | --------------------- | ------ |
| `admin@example.com`  | `playground-password` | admin  |
| `editor@example.com` | `playground-password` | editor |
| `viewer@example.com` | `playground-password` | viewer |
| a new account        | your choice           | viewer |

Sign in at `/sign-in`. `e2e/better-auth.spec.ts` runs only in this mode.

## Roles

Pick a role in the bar at the top. It sets a cookie that the auth adapter turns into a `devAuth` user. Without the cookie you are `admin`.

| Role      | Can                                     |
| --------- | --------------------------------------- |
| admin     | everything, including settings          |
| editor    | create and edit authors, tags and posts |
| viewer    | read                                    |
| anonymous | read published posts, authors and tags  |

`devAuth` trusts the client. Do not deploy this app. A production build (`next start`) refuses requests unless `QUICKBEN_PLAYGROUND_DEMO=1` is set; the e2e tests set it.

## Tests

```sh
pnpm --filter @quickben/playground build
CI=1 pnpm --filter @quickben/playground test:e2e   # Playwright, against `next start`
CI=1 QUICKBEN_TENANCY=1 QUICKBEN_DB=memory pnpm --filter @quickben/playground test:e2e
```

Without `CI` the tests start `next dev` or reuse a server on port 3300.
