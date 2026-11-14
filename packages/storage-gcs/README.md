# @quickben/storage-gcs

Google Cloud Storage for [Quickben](https://quickben.vialabs.net) file fields, with the official SDK.

```sh
pnpm add @quickben/storage-gcs @google-cloud/storage
```

```ts
import { defineConfig } from "@quickben/core";
import { gcsStorage } from "@quickben/storage-gcs";

export default defineConfig({
  db,
  storage: gcsStorage({ bucket: "my-app-files", prefix: "uploads/" }),
  collections: [docs],
});
```

| Option    | Default         | Purpose                                                         |
| --------- | --------------- | --------------------------------------------------------------- |
| `bucket`  | required        | Bucket name, or a `Bucket` from your own `Storage` client.      |
| `storage` | `new Storage()` | Client for a bucket name. Uses Application Default Credentials. |
| `prefix`  | none            | Folder for every key.                                           |

`signedUrl(key, { expiresIn, downloadName })` returns a V4 read URL. `@google-cloud/storage` (7 or later) is an optional peer dependency. The adapter loads it on first use.
