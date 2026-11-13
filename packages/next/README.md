# @quickben/next

Next.js App Router integration for [Quickben](https://quickben.vialabs.net): REST route handlers and server helpers.

```sh
pnpm add @quickben/next
```

## Route handlers

```ts
// app/api/[...quickben]/route.ts
import { createRouteHandlers } from "@quickben/next";

import config from "@/quickben.config";

export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config);
```

| Route                     | Local API call                             | Success |
| ------------------------- | ------------------------------------------ | ------- |
| `GET /_meta`              | see below                                  | 200     |
| `GET /:collection`        | `qb.find`                                  | 200     |
| `GET /:collection/:id`    | `qb.findById`                              | 200     |
| `POST /:collection`       | `qb.create`                                | 201     |
| `PATCH /:collection/:id`  | `qb.update`                                | 200     |
| `DELETE /:collection/:id` | `qb.delete` (returns the deleted document) | 200     |

| Option         | Default          | Purpose                                                                 |
| -------------- | ---------------- | ----------------------------------------------------------------------- |
| `basePath`     | `/api`           | URL path of the catch-all route.                                        |
| `maxLimit`     | `100`            | Largest `limit` of `GET /:collection`.                                  |
| `csrf`         | `{}`             | Same-origin check on mutating methods. `{ trustedOrigins }` or `false`. |
| `maxBodyBytes` | `1048576` (1 MB) | Largest `POST` / `PATCH` body. Larger bodies get `413`.                 |

- The user comes from `config.auth.getUser(req)` on every request.
- Bodies must be JSON objects sent with `Content-Type: application/json`. `id`, `createdAt` and `updatedAt` are removed from bodies.
- Responses have `Cache-Control: private, no-store`.

### Query string

| Parameter | Format                                   | Example                           |
| --------- | ---------------------------------------- | --------------------------------- |
| `where`   | JSON, same shape as the local API        | `where={"status":{"eq":"draft"}}` |
| `sort`    | comma-separated keys, `-` for descending | `sort=-publishedAt,title`         |
| `limit`   | integer, at most `maxLimit`              | `limit=50`                        |
| `page`    | integer, from 1                          | `page=2`                          |
| `cursor`  | `nextCursor` of the previous result      | `cursor=…`                        |
| `depth`   | integer 0–3                              | `depth=1`                         |
| `select`  | comma-separated field names              | `select=title,status`             |

`GET /:collection/:id` accepts `depth` and `select`. Unknown parameters return `400`.

`where` is JSON because filters are trees (`and`, `or`) with typed values. JSON keeps numbers, booleans and arrays as they are, and maps one to one to the local API. Bracket encodings (`where[views][gte]=10`) turn every value into a string and need per-field type coercion.

`toSearchParams(query)` builds the query string for clients.

### Errors

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Validation failed. title: Required",
    "details": { "issues": [] }
  }
}
```

| Code                     | Status | `details`                                                                                      |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| `VALIDATION`             | 400    | `{ issues: [{ path, message }] }`                                                              |
| `UNAUTHORIZED`           | 401    | `null`                                                                                         |
| `FORBIDDEN`              | 403    | `null` (also CSRF)                                                                             |
| `NOT_FOUND`              | 404    | `null` (also unknown routes)                                                                   |
| `METHOD_NOT_ALLOWED`     | 405    | `null`, `Allow` header                                                                         |
| `CONFLICT`               | 409    | `{ field }`                                                                                    |
| `PAYLOAD_TOO_LARGE`      | 413    | `null` (body larger than `maxBodyBytes`)                                                       |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | `null`                                                                                         |
| `INTERNAL`               | 500    | `null`; the error is logged, not returned. Also for 5xx Quickben errors such as `ConfigError`. |

### `GET /_meta`

`{ title, user, collections, modules }`: collections (fields, labels, admin options, `access: { create, update, delete }`) and modules the user can read. Collections whose read rule returns `false` are left out. A rule that returns a filter counts as allowed. Functions (`validate`, function defaults) are not included.

### CSRF

Browsers send cookies with requests from any site. With cookie-based auth, another site could post forms to your API as the user. `POST`, `PATCH` and `DELETE` therefore check:

- with an `Origin` header: its host must be the request host (`Host` or `X-Forwarded-Host`) or a `trustedOrigins` entry;
- without `Origin`: `Sec-Fetch-Site: cross-site` is rejected;
- with neither (curl, server to server): allowed.

The JSON content type requirement also forces a CORS preflight for cross-site `fetch` calls. Turn the check off with `csrf: false` only for token auth that never uses cookies.

## Server helpers

| Export                      | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `getRequestContext(config)` | `{ user, req }` for local API calls in server components and server actions. |
| `getUser(config)`           | The current user, or `null`.                                                 |
| `currentRequest()`          | A `Request` built from `headers()` and `cookies()` of `next/headers`.        |
| `singleton(key, create)`    | One value per process. Use it for database clients created in the config.    |
| `getMeta(qb, ctx)`          | The `GET /_meta` body.                                                       |

```tsx
// app/page.tsx (getQuickben comes from @quickben/core)
const qb = await getQuickben(config);
const posts = await qb.find("posts", { limit: 10 }, await getRequestContext(config));
```

`currentRequest()` takes cookies from `cookies()`, so a cookie set earlier in the same server action (a sign-in) is seen by the auth adapter.

No `next.config` wrapper is needed.
