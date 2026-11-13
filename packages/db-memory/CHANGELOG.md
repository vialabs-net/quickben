# @quickben/db-memory

## 0.2.0

### Patch Changes

- @quickben/core@0.2.0

## 0.1.0

### Minor Changes

- e70ef29: First release: collections, fields, type inference, validation, the portable query model, the database adapter contract, the local API with access rules, hooks and plugins, `devAuth`, and the in-memory adapter.
- eb5c707: Access hardening and one API change before 0.1.
  
  - Core: `findById(slug, id, query, ctx)`. The context is no longer merged with `select` and `depth`.
  - Core: relation values must point to documents the user can read (`overrideAccess`: they must exist).
  - Core: an update filter also applies to the updated document, so a document cannot leave the filter.
  - Core: `update` and `delete` of a document the user cannot read throw `NotFoundError`.
  - Core: cursor values are validated against the sort fields.
  - Core: `getQuickben` caches on `globalThis`, so every copy of the package shares one instance per config.
  - Core: field names must be unique without case; reserved names match in any case.
  - Next: 5xx Quickben errors (such as `ConfigError`) are returned as `INTERNAL` without their message.
  - Memory adapter: an update no longer brings back a document deleted by a concurrent commit.
  - Tenancy: a suspended organization is read-only for its members.

### Patch Changes

- Updated dependencies [e70ef29]
- Updated dependencies [d62a1a8]
- Updated dependencies [811793e]
- Updated dependencies [991ab37]
- Updated dependencies [745dd01]
- Updated dependencies [eb5c707]
  - @quickben/core@0.1.0
