# {{name}}

A Next.js app built with [Quickben](https://quickben.vialabs.net). Database: {{database}}.

## Start

```sh
{{install}}
{{run}} dev
```

| URL                              | What                                     |
| -------------------------------- | ---------------------------------------- |
| http://localhost:3000            | Home page. Reads with the local API.     |
| http://localhost:3000/admin      | Admin UI generated from the collections. |
| http://localhost:3000/api/\_meta | REST API (`/api/<collection>`, …).       |

## Files

| File                                 | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| `quickben.config.ts`                 | Collections, database and auth.                     |
| `lib/db.ts`                          | Database adapter.                                   |
| `lib/auth.ts`                        | Auth adapter. `devAuth()` in development.           |
| `app/api/[...quickben]/route.ts`     | REST route handlers.                                |
| `app/admin/[[...segments]]/page.tsx` | Admin page and its server function.                 |
| `app/page.tsx`                       | Home page.                                          |
| `next.config.ts`                     | Cache Components on. PGlite is not bundled.         |
| `.env.local`                         | Local settings, from `.env.example`. Not committed. |

## Database

{{databaseNotes}}

## Auth

In development, `devAuth()` signs you in as the user in `QUICKBEN_DEV_USER` (`.env.local`). Remove the variable to browse as an anonymous visitor. In production every visitor is anonymous: replace `lib/auth.ts` with an auth adapter for your identity provider before you deploy.

## Next steps

- Add fields and collections in `quickben.config.ts`. Types, the REST API and the admin follow.
- Read data in server components with `getQuickben(config)` and `getRequestContext(config)` from `@quickben/next`.
- Docs: https://quickben.vialabs.net
