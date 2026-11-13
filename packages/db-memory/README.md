# @quickben/db-memory

In-memory database adapter for [Quickben](https://quickben.vialabs.net). Use it in tests and demos. Data is lost when the process exits.

```ts
import { defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

export default defineConfig({
  db: memoryAdapter({ initialData: { posts: [] } }),
  collections: [posts],
});
```

| Behavior     | Details                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Transactions | Copy-on-write. Changes are applied to the latest data on commit; unique values are checked again. |
| Isolation    | Reads outside a transaction do not see its writes until commit.                                   |
| `raw`        | `{ collections }`: the documents the adapter can see, keyed by slug and id.                       |

It is the reference adapter for `@quickben/adapter-tests`.
