---
"@quickben/core": patch
"@quickben/next": patch
"@quickben/admin": patch
"@quickben/plugin-connections": patch
"@quickben/plugin-tenancy": patch
"@quickben/plugin-doc-reader": patch
"@quickben/plugin-templates": patch
---

Admin gaps found by the first embedded host app:

- `pageTitle: "none"` hides page titles and breadcrumbs (admin and plugin pages); `getAdminNav(…, { pathname }).page` gives the title and breadcrumb to the host.
- The dashboard tells "nothing set up yet" from "no access".
- Layout tokens: `--qb-card-radius`, `--qb-card-padding`, `--qb-title-size`, `--qb-title-weight`, `--qb-heading-size`, `--qb-heading-weight`, `--qb-table-row-height`.
- `json` fields whose schema is a list of objects get a row editor (`FieldMeta.rows`, `jsonRowColumns`, `RowsEditor`); plugin-connections uses it for LLM models.
- Selects and relation chips fit their column; tables scroll in their own box and never widen the page.
- `ListToolbar` in `@quickben/admin/ui`; the connections and credentials lists get search and filters.
