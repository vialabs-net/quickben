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

## Roles

Pick a role in the bar at the top. It sets a cookie that the auth adapter turns into a `devAuth` user. Without the cookie you are `admin`.

| Role      | Can                                     |
| --------- | --------------------------------------- |
| admin     | everything, including settings          |
| editor    | create and edit authors, tags and posts |
| viewer    | read                                    |
| anonymous | read published posts, authors and tags  |

`devAuth` trusts the client. Do not deploy this app.

## Tests

```sh
pnpm --filter @quickben/playground build
CI=1 pnpm --filter @quickben/playground test:e2e   # Playwright, against `next start`
```

Without `CI` the tests start `next dev` or reuse a server on port 3300.
