# @quickben/storage-local

Local filesystem storage for [Quickben](https://quickben.vialabs.net) file fields. Use it in development, tests, one server or a shared volume.

```ts
import { defineConfig } from "@quickben/core";
import { localFileStorage } from "@quickben/storage-local";

export default defineConfig({
  db,
  storage: localFileStorage({ root: "./uploads" }),
  collections: [docs],
});
```

| Behavior     | Details                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| Keys         | Checked with `assertStorageKey` and resolved inside `root`.                           |
| Writes       | To a temporary file, then renamed. Folders are created on demand.                     |
| Content type | From the key's extension (core names stored files `…/<id>.png`).                      |
| Signed URLs  | Not supported. Serve files with the `@quickben/next` route `/:collection/:id/:field`. |
