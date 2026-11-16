# @quickben/storage-s3

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- 102d4f2: Files and storage adapters.
  
  - `@quickben/core`: `StorageAdapter` (`put`, `get`, `getBytes`, `head`, `delete`, optional `signedUrl`), `assertStorageKey`, `memoryStorage`, `sniffMime`, `detectMime`. Config `storage`. `fields.file({ accept, maxBytes, storage })` stores `{ key, name, mime, size, sha256 }`; uploads are checked by their first bytes. Replaced and deleted files are removed after the commit; files of a rolled-back transaction are removed. `qb.readFile(slug, id, field, ctx)` follows read access.
  - `@quickben/db-drizzle`: file fields are JSON columns.
  - `@quickben/next`: `POST` and `PATCH` accept `multipart/form-data` (`_payload` JSON part, one part per file field, `maxUploadBytes`). `GET /:collection/:id/:field` streams a file. `_meta` describes `accept` and `maxBytes`.
  - `@quickben/admin`: file input with image and PDF preview, size check and a remove checkbox. Option `apiBasePath` (default `/api`).
  - `@quickben/storage-local`, `@quickben/storage-gcs`, `@quickben/storage-s3`: new storage adapters. The cloud SDKs are optional peer dependencies.
  - `@quickben/plugin-doc-reader`: `files` takes a `StorageAdapter`; the default is the config `storage`, else memory. `FileStore`, `memoryFileStore` and `localFileStore` are deprecated and still work.
  - `@quickben/plugin-templates`: brands have a `logoFile` file field (option `storage`, default the config `storage`). Without storage the brand form keeps the old `data:` URL `logo`. `migrateBrandLogos(qb)` moves old logos to `logoFile`.
  
  Not breaking for existing apps. The `brands` collection gets a `logoFile` column: run your migration tool if you do not use `push`. Admin uploads go through server actions, whose body limit is 1 MB by default (`experimental.serverActions.bodySizeLimit`).

### Patch Changes

- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
  - @quickben/core@0.3.0
