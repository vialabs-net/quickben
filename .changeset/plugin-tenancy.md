---
"@quickben/plugin-tenancy": minor
"@quickben/core": minor
"@quickben/admin": minor
---

New `@quickben/plugin-tenancy` 0.1.0: organizations, memberships, roles, module entitlements, tenant-scoped collections, membership guard rails, local API helpers and an admin extension (`@quickben/plugin-tenancy/admin`).

Core: `definePlugin({ addFields })` adds typed fields to existing collections. Access rules get `ctx` and `qb`; hooks get `ctx`. `RelationField` takes a `THasDefault` parameter.

Admin: extensions can add `sidebar` components.
