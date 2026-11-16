# @quickben/core

Collections, fields, access rules, hooks, plugins and the typed local API of [Quickben](https://quickben.vialabs.net). It never imports a database library: storage goes through a `DatabaseAdapter`.

```sh
pnpm add @quickben/core
```

## Exports

| Export                                                                                         | Purpose                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `defineCollection`                                                                             | Define a collection. Types are inferred from its fields.                                                                            |
| `fields`                                                                                       | Field factories: `text`, `textarea`, `email`, `url`, `number`, `boolean`, `date`, `datetime`, `select`, `relation`, `json`, `file`. |
| `defineConfig`                                                                                 | Combine collections, plugins, auth and the adapter.                                                                                 |
| `definePlugin`, `extendCollection`                                                             | Write plugins that add or change collections.                                                                                       |
| `getQuickben`, `createQuickben`                                                                | Get the local API (`find`, `findById`, `count`, `create`, `update`, `delete`, `transaction`, `readFile`).                           |
| `checkAccess`, `checkFieldAccess`                                                              | Evaluate collection or field access rules without touching data (for UI and HTTP layers).                                           |
| `formatDateValue`, `zonedTimeToUtc`, `localDateTime`, `dateInTimeZone`                         | Time zone helpers on `Intl`. Core never uses the server time zone.                                                                  |
| `StorageAdapter`, `memoryStorage`, `assertStorageKey`, `sniffMime`, `detectMime`               | File storage contract and helpers. See "Files" below.                                                                               |
| `defineEndpoint`, `reply`, `endpointFactory`                                                   | Custom HTTP endpoints typed from Zod schemas. See "Endpoints" below.                                                                |
| `devAuth`                                                                                      | Development-only auth adapter that trusts a header.                                                                                 |
| `QuickbenError` and subclasses                                                                 | Errors with stable `code` and suggested HTTP `status`.                                                                              |
| `matchesWhere`, `compareValues`, `compareBySort`                                               | Reference query semantics, for adapter authors.                                                                                     |
| `jsonRowColumns`, `jsonSchemaRowColumns`, `JsonRowColumn`                                      | Columns of a row editor for a Zod or JSON Schema list of objects with primitive properties. `null` for other shapes.                |
| `InferDoc`, `InferCreateInput`, `InferUpdateInput`, `InferWhere`, `InferSort`, `InferRegistry` | Type helpers.                                                                                                                       |

## Example

```ts
import { defineCollection, defineConfig, fields as f, getQuickben } from "@quickben/core";
import type { InferDoc } from "@quickben/core";

export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: f.text({ required: true }),
    author: f.relation({ to: "users" }),
    tags: f.select({ options: ["news", "tech"], many: true }),
  },
  access: {
    read: () => true,
    update: ({ user }) => (user ? { author: { eq: user.id } } : false),
  },
});

export type Post = InferDoc<typeof posts>;
```

Every call takes a request context: `qb.find("posts", { limit: 10 }, { user })`. Pass `overrideAccess: true` only from trusted server code.

## Errors

| Code           | Status | Thrown when                                                     |
| -------------- | ------ | --------------------------------------------------------------- |
| `VALIDATION`   | 400    | Input, `where`, `sort`, `select` or cursor is invalid.          |
| `UNAUTHORIZED` | 401    | Access denied and there is no user.                             |
| `FORBIDDEN`    | 403    | Access denied for the user.                                     |
| `NOT_FOUND`    | 404    | Unknown collection, or the document is missing or not readable. |
| `CONFLICT`     | 409    | A unique value or id is taken.                                  |
| `CONFIG`       | 500    | The config is invalid.                                          |

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the query model and the adapter contract.

## Files

| Part          | Use                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`     | `defineConfig({ storage })`: default `StorageAdapter` of file fields. Adapters: `memoryStorage()`, `@quickben/storage-local`, `-gcs`, `-s3`.   |
| `f.file()`    | `{ accept, maxBytes, storage }`. Stores `{ key, name, mime, size, sha256 }`. Input: `Blob`, `{ name, bytes }`, the stored reference or `null`. |
| Checks        | Size, empty, type from the first bytes, `accept`, `validate`. All uploads are checked before any is stored.                                    |
| Cleanup       | Replaced and deleted files are removed after the commit; files of a rolled-back transaction are removed.                                       |
| `qb.readFile` | `(slug, id, field, ctx)` → `{ file, body, size }`. Needs read access to the document and the field.                                            |

## Field access, afterCommit, time zones

| Feature       | Use                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field access  | `f.number({ access: { read, create, update } })`, rules return booleans. Unreadable fields leave documents and `select`; `where` and `sort` on them give `VALIDATION`. Writing an unwritable field gives `FORBIDDEN` with `error.fields`. |
| `afterCommit` | Hook after the transaction commits, with `{ operation, doc, original, qb }`. `qb` is not transactional. Errors are logged. Nested writes wait for the outermost commit.                                                                   |
| `timeZone`    | `defineConfig({ timeZone })` and `f.date({ timeZone })`. `Date` and offset inputs resolve in it. Default `UTC`.                                                                                                                           |

## Endpoints

| Part                                  | Use                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `defineEndpoint({ method, path, … })` | `version`, `input: { params, query, body }`, `output`, `access`, `transactional`, `deprecated`, `sunset`, `handler`.    |
| `defineConfig({ endpoints })`         | Register endpoints. Plugins use `definePlugin({ endpoints })`.                                                          |
| `@quickben/core/http`                 | `handleEndpointRequest(config, request)`: `Response`, or `null` when no path matches. Mount it in any Fetch API server. |

Docs: [Endpoints](https://quickben.vialabs.net/docs/concepts/endpoints).
