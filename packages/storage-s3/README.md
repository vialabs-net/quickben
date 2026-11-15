# @quickben/storage-s3

Amazon S3 and S3-compatible stores (Cloudflare R2, MinIO) for [Quickben](https://quickben.vialabs.net) file fields, with the AWS SDK v3.

```sh
pnpm add @quickben/storage-s3 @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```ts
import { defineConfig } from "@quickben/core";
import { s3Storage } from "@quickben/storage-s3";

export default defineConfig({
  db,
  storage: s3Storage({ bucket: "my-app-files", clientConfig: { region: "us-east-1" } }),
  collections: [docs],
});
```

| Option         | Default                      | Purpose                           |
| -------------- | ---------------------------- | --------------------------------- |
| `bucket`       | required                     | Bucket name.                      |
| `client`       | `new S3Client(clientConfig)` | Your own client.                  |
| `clientConfig` | `{}`                         | Region, endpoint and credentials. |
| `prefix`       | none                         | Folder for every key.             |

`signedUrl(key, { expiresIn, downloadName })` needs `@aws-sdk/s3-request-presigner`. Both SDK packages are optional peer dependencies, loaded on first use.
