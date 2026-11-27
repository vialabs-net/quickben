# @quickben/adapter-tests

Contract test suite for Quickben database adapters. Private to this monorepo.

```ts
import { runAdapterContractTests } from "@quickben/adapter-tests";
import { myAdapter } from "../src";

runAdapterContractTests(() => myAdapter());
```

`createAdapter` must return a new, empty adapter for each test. The suite covers CRUD, every `where` operator, sorting with nulls, page and cursor pagination, `select`, `count`, unique conflicts, transaction rollback, and relation loading through core.

## Storage and email

`runStorageContractTests(() => fooStorage())` checks a `StorageAdapter`.

`runEmailContractTests(harness)` checks an `EmailAdapter` with a mocked `fetch`, so no request leaves the machine. The harness creates the adapter from `{ apiKey, from, fetch, timeoutMs }` and builds the provider's success and error answers:

```ts
runEmailContractTests({
  create: (options) => fooEmail(options),
  accepted: () => Response.json({ id: "msg_1" }),
  rejected: (status, message) => Response.json({ message }, { status }),
  idempotencyKeyOf: (request) => request.headers["idempotency-key"],
});
```

It covers the API key (string and getter), `not_configured` without a key or sender, validation before any request, provider error messages, retryable statuses, network errors, timeouts, and that the key never appears in `detail`.
