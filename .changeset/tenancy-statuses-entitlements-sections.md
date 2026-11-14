---
"@quickben/plugin-tenancy": minor
"@quickben/admin": minor
---

Tenancy: organization statuses, module expiry, added fields and settings sections in the admin, delete modes.

- `@quickben/plugin-tenancy`: `statuses` (access `full`, `limited` or `none`, for members and optionally platform staff, with a `label`) and `defaultStatus`; defaults keep `active` and `suspended`. `OrganizationError` reason `inactive` for other blocking statuses. `organization.modules` takes `{ key, expiresAt, source }` next to plain keys; expired modules count as disabled. `onOrganizationDelete`: `restrict` (default, `TenancyRuleError` `not-empty`) or `cascade`. `platformRoles` and `isPlatformStaff`. Helpers `activeModules`, `moduleKeys`, `isExpired`, `toGrant`. Admin: fields added to `organizations` and `memberships` render in the settings form and a member Details dialog, with field access; `tenancyAdmin(config, { sections })` adds settings tabs.
- `@quickben/admin`: `@quickben/admin/forms` entry (`FieldInput`, `loadFieldContext`, `parseFormData`, `editableFields`, `formScope`). `PageProps` has `serverFunction`.

Breaking: deleting an organization that still has scoped documents now throws `TenancyRuleError` `not-empty`; pass `onOrganizationDelete: "cascade"` to delete them. `OrganizationRecord.status` and the inferred `organizations.status` are `string`; `organizations.modules` is `ModuleEntitlement[]`.
