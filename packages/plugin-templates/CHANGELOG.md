# @quickben/plugin-templates

## 0.3.0

### Minor Changes

- 2aa9bd5: Admin languages, embedded mode and theme tokens.
  
  - `@quickben/core`: `LocalizedText` labels (string or per-locale record) for collections, fields, modules, nav items and `admin.title`. `admin.locale`, `admin.messages`, `admin.timeZone`. `localize`, `negotiateLocale`, `localeFromRequest`.
  - `@quickben/next`: `getMeta` and `collectionMeta` take `{ locale }` and return plain strings.
  - `@quickben/admin`: `@quickben/admin/i18n` with `defineMessages`, `useAdminI18n`, `createAdminI18n`, `missingMessages`; English and Spanish catalogs. `i18n` in page, view and sidebar props. `chrome: "none"`, `getAdminNav`, `getAdminLocale`, `getAdminI18n`. Public `--qb-*` theme tokens with light and dark defaults.
  - Plugins: every admin page uses its own message catalog (English and Spanish) and the theme tokens. `createOrganizationSwitcher` in `@quickben/plugin-tenancy/admin`.
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

- 66c95ed: Field access rules, `afterCommit` hooks and time zones for date inputs.
  
  - `@quickben/core`: field `access: { read, create, update }` returning booleans. Unreadable fields are removed from documents and `select` and rejected in `where` and `sort` (`ValidationError`). Input that sets an unwritable field throws `ForbiddenError` with `fields`. `checkFieldAccess`. `afterCommit` hooks run after the outermost transaction commits, with a non-transactional `qb`; errors are logged. `timeZone` in `defineConfig` and on `date`/`datetime` fields: `Date`, offset and offset-less inputs resolve in it (default `UTC`); the server time zone is never used. Strings in other formats are rejected in `where`. Helpers: `formatDateValue`, `zonedTimeToUtc`, `localDateTime`, `dateInTimeZone`, `isTimeZone`.
  - `@quickben/next`: `/_meta` leaves out unreadable fields and gives each field `access: { create, update }` and date fields `timeZone`. `FORBIDDEN` from field rules has `details: { fields }`.
  - `@quickben/admin`: unreadable fields are not shown; unwritable fields are read-only and not submitted. `datetime-local` inputs use the admin time zone, which defaults to the config `timeZone`. Message key `edit.utc` is now `edit.timeZone` (`{zone}`).
  - `@quickben/plugin-templates`: dates are formatted with `formatDateValue`.
- Updated dependencies [2aa9bd5]
- Updated dependencies [66c95ed]
- Updated dependencies [102d4f2]
- Updated dependencies [1396c30]
  - @quickben/core@0.3.0
  - @quickben/next@0.3.0
  - @quickben/admin@0.3.0

## 0.2.0

### Patch Changes

- @quickben/admin@0.2.0
  - @quickben/core@0.2.0
  - @quickben/next@0.2.0

## 0.1.0

### Minor Changes

- 773a6c8: New `@quickben/plugin-templates` 0.1.0: brands, versioned document templates per kind (one draft and one immutable published version), kinds registered with `defineTemplateKind`, a condition language without eval, validation that points at nodes, HTML rendering with a letterhead, a pluggable PDF renderer with a Chromium implementation (`@quickben/plugin-templates/chromium`), and an admin extension with a lazy-loaded TipTap editor, live preview, publishing and a Brand page (`@quickben/plugin-templates/admin`).

### Patch Changes

- Updated dependencies [e70ef29]
- Updated dependencies [d62a1a8]
- Updated dependencies [811793e]
- Updated dependencies [991ab37]
- Updated dependencies [745dd01]
- Updated dependencies [eb5c707]
  - @quickben/core@0.1.0
  - @quickben/next@0.1.0
  - @quickben/admin@0.1.0
