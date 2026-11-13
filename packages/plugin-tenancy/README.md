# @quickben/plugin-tenancy

Multi-tenancy for [Quickben](https://quickben.vialabs.net): organizations, memberships, roles, module entitlements and tenant-scoped collections.

```sh
pnpm add @quickben/plugin-tenancy
```

```ts
import { defineConfig } from "@quickben/core";
import { tenancy } from "@quickben/plugin-tenancy";

export default defineConfig({
  db,
  collections: [posts],
  plugins: [tenancy({ scope: ["posts"] })],
});
```

Every document in `posts` now belongs to one organization. Reads, updates and deletes only see the active organization. Creates get its id.

## What the plugin adds

| Addition             | Details                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `organizations`      | `name`, `slug` (unique), `status` (`active`, `suspended`), `modules`, `metadata`.                   |
| `memberships`        | `organization`, `user`, `email`, `role`, `status`, `modules`, `invitedBy`, `invitedAt`, `joinedAt`. |
| `organization` field | On each collection in `scope`. Relation, required, indexed. Optional in create input.               |
| `ctx.organizationId` | New optional key of `RequestContext`.                                                               |

Invitations are memberships with status `invited`. One collection keeps one uniqueness rule (one membership per user or email per organization) and one set of access rules.

## Options

| Option                  | Default                                | Purpose                                                    |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `scope`                 | required                               | Slugs of tenant-scoped collections.                        |
| `roles`                 | `defaultRoles`                         | Capabilities per role, highest rank first.                 |
| `ownerRole`             | `owner`                                | Every organization keeps one active member with this role. |
| `defaultRole`           | `member`                               | Role of new memberships.                                   |
| `isPlatformAdmin`       | `user.roles` includes `platform-admin` | Platform staff: see all organizations or act in one.       |
| `canCreateOrganization` | any signed-in user                     | Who may create organizations.                              |
| `defaultModules`        | `"all"`                                | Modules of a new organization.                             |
| `header`                | `x-quickben-organization`              | Request header with the active organization id.            |
| `cookie`                | `quickben-organization`                | Cookie with the active organization id.                    |

List `tenancy()` after the plugins that add scoped collections.

## Roles and capabilities

| Role     | Capabilities                                                                    |
| -------- | ------------------------------------------------------------------------------- |
| `owner`  | `read`, `write`, `members:manage`, `organization:manage`, `organization:delete` |
| `admin`  | `read`, `write`, `members:manage`, `organization:manage`                        |
| `member` | `read`, `write`                                                                 |
| `viewer` | `read`                                                                          |

| Capability            | Checked by the plugin                               |
| --------------------- | --------------------------------------------------- |
| `read`                | Reads of scoped collections and of the member list. |
| `write`               | Creates, updates and deletes in scoped collections. |
| `members:manage`      | Creating, changing and removing memberships.        |
| `organization:manage` | Updating the organization.                          |
| `organization:delete` | Deleting the organization.                          |

Custom capabilities are allowed. Check them with `hasCapability(qb, ctx, "billing")`.

## Active organization

`resolveTenant(qb, ctx)` picks the first of:

1. `ctx.organizationId`
2. the `header`
3. the `cookie`
4. the user's only active membership

The user must be an active member and the organization must be `active`. Platform staff skip both checks. With nothing selected they see every organization.

| Error                            | When                                                |
| -------------------------------- | --------------------------------------------------- |
| `UnauthorizedError`              | No user.                                            |
| `OrganizationError` `none`       | No active membership.                               |
| `OrganizationError` `ambiguous`  | Several memberships and none selected.              |
| `OrganizationError` `not-member` | Selected organization without an active membership. |
| `OrganizationError` `unknown`    | Selected organization does not exist.               |
| `OrganizationError` `suspended`  | Organization is suspended.                          |

`OrganizationError` extends `ForbiddenError` (403). Results are cached per context object and dropped after membership or organization changes.

## Tenant-scoped collections

| Operation | Rule                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------- |
| read      | Your rule AND `{ organization: { eq: active } }`. Needs `read`.                                           |
| create    | `organization` is set from the active organization. Another value is `ForbiddenError`. Needs `write`.     |
| update    | Your rule AND the organization filter. Moving to another organization is `ForbiddenError`. Needs `write`. |
| delete    | Your rule AND the organization filter. Needs `write`.                                                     |

Anonymous users are denied. When a collection belongs to a module, the user also needs that module.

With `overrideAccess: true`, creates take `ctx.organizationId` when set. Nothing else is checked.

## Modules

`organization.modules` lists the enabled module keys. Only platform staff change it. `membership.modules` grants a subset; an empty list grants every module of the organization.

```ts
import { canUseModule, moduleAccess } from "@quickben/plugin-tenancy";

const reports = defineCollection({
  slug: "reports",
  fields: { name: f.text({ required: true }) },
  access: moduleAccess("reports", { read: () => true }),
});

await canUseModule(qb, ctx, "reports"); // boolean
```

Use `moduleAccess` for collections outside `scope`. Scoped collections check their module on their own.

## Guard rails

| Rule                                                                            | Error             |
| ------------------------------------------------------------------------------- | ----------------- |
| Membership changes need `members:manage` in that organization.                  | `ForbiddenError`  |
| The last active owner cannot be demoted, disabled or removed.                   | `ForbiddenError`  |
| Owners and admins cannot change their own role or status, or remove themselves. | `ForbiddenError`  |
| You cannot grant or manage a role ranked above yours.                           | `ForbiddenError`  |
| A membership keeps its organization, and its user once set.                     | `ValidationError` |
| Granted modules must be enabled for the organization.                           | `ValidationError` |
| One membership per user or email per organization.                              | `ConflictError`   |
| Only platform staff set `organization.modules` and `status`.                    | `ForbiddenError`  |

`overrideAccess` and platform staff skip the role checks. The last-owner rule always applies.

## Helpers

All take `(qb, ctx, …)` and go through the local API, so access rules apply.

| Helper                                 | Returns                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `resolveTenant(qb, ctx)`               | `Tenant`: organization, membership, role, capabilities, modules. |
| `hasCapability(qb, ctx, capability)`   | `boolean`                                                        |
| `canUseModule(qb, ctx, key)`           | `boolean`                                                        |
| `listMyOrganizations(qb, ctx)`         | Active memberships with their organization, by name.             |
| `listMyInvitations(qb, ctx)`           | Pending invitations for the user's id or email.                  |
| `inviteMember(qb, ctx, input)`         | New membership with status `invited`.                            |
| `acceptInvitation(qb, ctx, id)`        | The membership, now `active`.                                    |
| `updateMembership(qb, ctx, id, patch)` | Changed `role`, `status` or `modules`.                           |
| `removeMember(qb, ctx, id)`            | The deleted membership.                                          |
| `switchOrganization(qb, ctx, id)`      | `{ organizationId, tenant, cookie, setCookie }`.                 |
| `organizationCookie(qb, id \| null)`   | Cookie to set or clear the selection.                            |
| `getTenancy(qb)`                       | Resolved options: roles, cookie and header names.                |

Switching in a Next.js server action:

```ts
"use server";
import { getQuickben, getRequestContext } from "@quickben/next";
import { switchOrganization } from "@quickben/plugin-tenancy";
import { cookies } from "next/headers";

export async function selectOrganization(id: string) {
  const qb = await getQuickben(config);
  const { cookie } = await switchOrganization(qb, await getRequestContext(config), id);
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}
```

Route handlers and pages pass the request in `ctx`, so the cookie and header are read without extra code.

## Admin UI

```tsx
import { createAdminPage } from "@quickben/admin";
import { tenancyAdmin } from "@quickben/plugin-tenancy/admin";

export default createAdminPage(config, { serverFunction, extensions: [tenancyAdmin(config)] });
```

| Part                  | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| Sidebar switcher      | Lists your organizations (all of them for platform staff) and sets the cookie.          |
| `/admin/members`      | Members table, invite form, role, status and modules per member, remove.                |
| `/admin/organization` | Rename the organization; platform staff set status and modules; create an organization. |

Pass `basePath` when the admin is not at `/admin`. `@quickben/admin`, `@quickben/next`, `next` and `react` are needed only for this entry.

Server actions find the config through a registry filled when the page module loads. After a restart, a form submitted from an open tab can fail once; reload the page.
