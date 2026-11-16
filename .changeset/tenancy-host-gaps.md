---
"@quickben/plugin-tenancy": patch
---

Tenancy: options a host app needs to replace its member, organization and module pages.

| Option or export                                           | What it does                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emptyModules: "all" \| "none"`                            | What an empty membership `modules` list grants. Default `"all"` (unchanged). `["*"]` (`ALL_MODULES`) grants every module in both modes. Helpers take `modules: "all"`.                                                                                          |
| `migrateEmptyModules(qb)`                                  | Sets `["*"]` on memberships with `[]`. Run it once before you switch to `"none"`.                                                                                                                                                                               |
| `ctx.skipGuards`, `guardsSkipped(ctx)`                     | Guard rails apply to user actions. `overrideAccess` skips them; `skipGuards: false` keeps them, `skipGuards: true` has no effect without explicit `overrideAccess: true`.                                                                                       |
| `memberHooks`                                              | `onInvite`, `onAccept`, `onRoleChange`, `onStatusChange`, `onUpdate`, `onRemove`. They run in the helpers and the Members page, after the write and in its transaction, with the membership before and after. `MemberHookError` shows its message in the admin. |
| `canManageMember` option and helper                        | A host rule on top of `members:manage` (default: the rank rule). New rule code `cannot-manage`. The Members page shows forms only for members the user may manage.                                                                                              |
| `activeOrganization(req)`, `organizationFromPath(pattern)` | Read the active organization from the request, e.g. the URL path. Checked against memberships.                                                                                                                                                                  |
| `tenancyAdmin({ organizationHref })`                       | The switcher opens a host URL for the chosen organization.                                                                                                                                                                                                      |
| `updateMembership(…, { fields })`                          | Saves fields a host added to memberships; the details dialog uses it.                                                                                                                                                                                           |

**Migration**

- The last-owner rule no longer applies to calls with `overrideAccess: true`. Imports and repairs can now remove or demote the last owner. Pass `skipGuards: false` to keep the old behavior.
- Nothing else changes with the defaults. To make `[]` mean "no modules", run `migrateEmptyModules(qb)`, then set `emptyModules: "none"`.
