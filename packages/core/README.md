# @quickben/core

Collections, fields, access rules, hooks, plugins and the typed local API of [Quickben](https://quickben.vialabs.net). It never imports a database library: storage goes through a `DatabaseAdapter`.

```sh
pnpm add @quickben/core
```

## Exports

| Export                                                                                         | Purpose                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `defineCollection`                                                                             | Define a collection. Types are inferred from its fields.                                                                    |
| `fields`                                                                                       | Field factories: `text`, `textarea`, `email`, `url`, `number`, `boolean`, `date`, `datetime`, `select`, `relation`, `json`. |
| `defineConfig`                                                                                 | Combine collections, plugins, auth and the adapter.                                                                         |
| `definePlugin`, `extendCollection`                                                             | Write plugins that add or change collections.                                                                               |
| `getQuickben`, `createQuickben`                                                                | Get the local API (`find`, `findById`, `count`, `create`, `update`, `delete`, `transaction`).                               |
| `devAuth`                                                                                      | Development-only auth adapter that trusts a header.                                                                         |
| `QuickbenError` and subclasses                                                                 | Errors with stable `code` and suggested HTTP `status`.                                                                      |
| `matchesWhere`, `compareValues`, `compareBySort`                                               | Reference query semantics, for adapter authors.                                                                             |
| `InferDoc`, `InferCreateInput`, `InferUpdateInput`, `InferWhere`, `InferSort`, `InferRegistry` | Type helpers.                                                                                                               |

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
