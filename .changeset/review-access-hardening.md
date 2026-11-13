---
"@quickben/core": minor
"@quickben/next": minor
"@quickben/db-memory": minor
"@quickben/plugin-tenancy": minor
---

Access hardening and one API change before 0.1.

- Core: `findById(slug, id, query, ctx)`. The context is no longer merged with `select` and `depth`.
- Core: relation values must point to documents the user can read (`overrideAccess`: they must exist).
- Core: an update filter also applies to the updated document, so a document cannot leave the filter.
- Core: `update` and `delete` of a document the user cannot read throw `NotFoundError`.
- Core: cursor values are validated against the sort fields.
- Next: 5xx Quickben errors (such as `ConfigError`) are returned as `INTERNAL` without their message.
- Memory adapter: an update no longer brings back a document deleted by a concurrent commit.
- Tenancy: a suspended organization is read-only for its members.
