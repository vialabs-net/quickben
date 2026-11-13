# @quickben/adapter-tests

Contract test suite for Quickben database adapters. Private to this monorepo.

```ts
import { runAdapterContractTests } from "@quickben/adapter-tests";
import { myAdapter } from "../src";

runAdapterContractTests(() => myAdapter());
```

`createAdapter` must return a new, empty adapter for each test. The suite covers CRUD, every `where` operator, sorting with nulls, page and cursor pagination, `select`, `count`, unique conflicts, transaction rollback, and relation loading through core.

Pass `{ asciiCaseOnly: true }` as the second argument when `contains` and `startsWith` ignore case for ASCII letters only (SQLite). The non-ASCII case test is then expected to fail.
