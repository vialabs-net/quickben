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
| `organizations`      | `name`, `slug` (unique), `status` (configurable), `modules`, `metadata`.                            |
| `memberships`        | `organization`, `user`, `email`, `role`, `status`, `modules`, `invitedBy`, `invitedAt`, `joinedAt`. |
| `organization` field | On each collection in `scope`. Relation, required, indexed. Optional in create input.               |
| `ctx.organizationId` | New optional key of `RequestContext`.                                                               |

Invitations are memberships with status `invited`. One collection keeps one uniqueness rule (one membership per user or email per organization) and one set of access rules.

## Options

| Option                  | Default                                      | Purpose                                                    |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `scope`                 | required                                     | Slugs of tenant-scoped collections.                        |
| `roles`                 | `defaultRoles`                               | Capabilities per role, highest rank first.                 |
| `ownerRole`             | `owner`                                      | Every organization keeps one active member with this role. |
| `defaultRole`           | `member`                                     | Role of new memberships.                                   |
| `isPlatformAdmin`       | `user.roles` includes a `platformRoles` role | Platform staff: see all organizations or act in one.       |
| `platformRoles`         | `["platform-admin"]`                         | Roles that make a user platform staff.                     |
| `statuses`              | `defaultStatuses`                            | Organization statuses and their access level.              |
| `defaultStatus`         | the first status                             | Status of new organizations.                               |
| `onOrganizationDelete`  | `"restrict"`                                 | `"restrict"` or `"cascade"` for scoped documents.          |
| `canCreateOrganization` | any signed-in user                           | Who may create organizations.                              |
| `defaultModules`        | `"all"`                                      | Modules of a new organization.                             |
| `header`                | `x-quickben-organization`                    | Request header with the active organization id.            |
| `cookie`                | `quickben-organization`                      | Cookie with the active organization id.                    |
| `activeOrganization`    | none                                         | Read the active organization id from the request.          |
| `emptyModules`          | `"all"`                                      | What an empty membership `modules` list grants.            |
| `memberHooks`           | none                                         | Hooks of the member helpers and the Members page.          |
| `canManageMember`       | the rank rule                                | Who may invite, change or remove which member.             |

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
2. `activeOrganization(req)`
3. the `header`
4. the `cookie`
5. the user's only active membership

The user must be an active member and the organization must be `active`. Platform staff skip both checks. With nothing selected they see every organization.

| Error                            | When                                                |
| -------------------------------- | --------------------------------------------------- |
| `UnauthorizedError`              | No user.                                            |
| `OrganizationError` `none`       | No active membership.                               |
| `OrganizationError` `ambiguous`  | Several memberships and none selected.              |
| `OrganizationError` `not-member` | Selected organization without an active membership. |
| `OrganizationError` `unknown`    | Selected organization does not exist.               |
| `OrganizationError` `suspended`  | Status is `suspended`.                              |
| `OrganizationError` `inactive`   | Another status without full access.                 |

`OrganizationError` extends `ForbiddenError` (403). Results are cached per context object and dropped after membership or organization changes.

### Organization in the URL

```ts
import { organizationFromPath, tenancy } from "@quickben/plugin-tenancy";

tenancy({ scope, activeOrganization: organizationFromPath("/settings/t/:organization") });
```

The id in `/settings/t/<id>/…` selects the organization. The user must still be an active member. Next.js does not give server components the URL path, so set it in `proxy.ts`:

```ts
import { pathnameHeaders } from "@quickben/next";
import { NextResponse } from "next/server";

export function proxy(request: Request) {
  return NextResponse.next({ request: { headers: pathnameHeaders(request) } });
}

export const config = { matcher: ["/settings/t/:path*"] };
```

Mount the admin with `basePath: "/settings/t/<id>"` and pass `organizationHref` to `tenancyAdmin` and `createOrganizationSwitcher`, so the switcher opens the URL of the chosen organization. The playground does this in `app/orgs/[organization]`.

## Tenant-scoped collections

| Operation | Rule                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------- |
| read      | Your rule AND `{ organization: { eq: active } }`. Needs `read`.                                           |
| create    | `organization` is set from the active organization. Another value is `ForbiddenError`. Needs `write`.     |
| update    | Your rule AND the organization filter. Moving to another organization is `ForbiddenError`. Needs `write`. |
| delete    | Your rule AND the organization filter. Needs `write`.                                                     |

Anonymous users are denied. When a collection belongs to a module, the user also needs that module.

With `overrideAccess: true`, creates take `ctx.organizationId` when set. Nothing else is checked.

## Statuses

| Level     | Scoped data    | Organization and memberships         |
| --------- | -------------- | ------------------------------------ |
| `full`    | read and write | read and write, by role              |
| `limited` | no access      | read only                            |
| `none`    | no access      | hidden; own memberships stay visible |

```ts
tenancy({
  scope: ["posts"],
  statuses: {
    onboarding: { access: { members: "limited", staff: "full" }, label: { en: "Onboarding" } },
    active: { access: "full" },
    suspended: { access: "limited" },
  },
});
```

A level alone applies to members; platform staff keep `full`. The defaults (`defaultStatuses`) are `active` (full) and `suspended` (limited).

## Modules

`organization.modules` lists the enabled modules: keys, or `{ key, expiresAt, source }`. From `expiresAt` on, the module counts as disabled in scoped access, `canUseModule` and `moduleAccess`. Plain keys never expire, so existing lists stay valid. Only platform staff change the list. `activeModules(entries)` gives the keys in use now.

`membership.modules` grants a subset:

| `membership.modules` | `emptyModules: "all"` (default) | `emptyModules: "none"` |
| -------------------- | ------------------------------- | ---------------------- |
| `["*"]`              | every module                    | every module           |
| `[]`                 | every module                    | no module              |
| `["sales"]`          | `sales`                         | `sales`                |

New memberships get every module: `[]` with `"all"`, `["*"]` with `"none"`. The helpers take `modules: "all"` and store `["*"]` (`ALL_MODULES`).

To switch an existing app to `"none"`, run `migrateEmptyModules(qb)` once before you deploy the option. It sets `["*"]` on every membership with an empty list, so members keep their modules. It writes through the adapter, without hooks, and returns the number of changed memberships. Pause membership edits until the migration finishes: the adapter does not lock rows, so concurrent edits could be overwritten.

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

| Rule                                                                            | Error                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Membership changes need `members:manage` in that organization.                  | `ForbiddenError`                                |
| The last active owner cannot be demoted, disabled or removed.                   | `TenancyRuleError` `last-owner`                 |
| Owners and admins cannot change their own role or status, or remove themselves. | `TenancyRuleError` `own-role`, `own-membership` |
| You cannot grant or manage a role ranked above yours.                           | `TenancyRuleError` `higher-role`                |
| A membership keeps its organization, and its user once set.                     | `ValidationError`                               |
| Granted modules must be enabled for the organization.                           | `ValidationError`                               |
| One membership per user or email per organization.                              | `ConflictError`                                 |
| Only platform staff set `organization.modules` and `status`.                    | `TenancyRuleError` `platform-only`              |
| `canManageMember` refused the change.                                           | `TenancyRuleError` `cannot-manage`              |

| Deleting an organization with scoped documents (`onOrganizationDelete: "restrict"`). | `TenancyRuleError` `not-empty` |

With `"cascade"`, scoped documents are deleted through the local API in the same transaction, so their hooks run and a failure rolls back the whole delete.

The guard rails (last owner, own role, rank, `canManageMember`) apply to user actions:

| Context                                   | Guard rails                                                  |
| ----------------------------------------- | ------------------------------------------------------------ |
| A user                                    | applied                                                      |
| Platform staff                            | last owner only                                              |
| `overrideAccess: true` (imports, repairs) | skipped                                                      |
| `overrideAccess: true, skipGuards: false` | last owner only                                              |
| A user with `skipGuards: true`            | applied; explicit `overrideAccess: true` is required to skip |

`guardsSkipped(ctx)` says whether they are skipped. Before 0.3.2, the last-owner rule also applied with `overrideAccess`. `TenancyRuleError` extends `ForbiddenError`; `rule` says which rule failed.

### Who may manage which member

`canManageMember` runs after the `members:manage` check, for invites, changes and removals (not for leaving). The rank rule always applies; a host policy can restrict it further.

```ts
tenancy({
  scope,
  // A branch admin manages only members of their branch.
  canManageMember: async ({ allowedByRank, actor, target }) =>
    allowedByRank && (await sameBranch(actor.id, target.user)),
});
```

| Argument          | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| `action`          | `invite`, `update` or `remove`                               |
| `actor`           | The user                                                     |
| `actorMembership` | The user's active membership there, or `null`                |
| `target`          | The stored membership; for `invite`, the new one             |
| `next`            | The membership after the change; `null` for `remove`         |
| `allowedByRank`   | The user's role ranks at least as high as the roles involved |
| `qb`              | Local API bound to the transaction                           |

`canManageMember(qb, ctx, membership, action?)` gives the same answer for UIs. The Members page shows forms only for members the user may manage.

### Member hooks

```ts
import { MemberHookError, tenancy } from "@quickben/plugin-tenancy";

tenancy({
  scope,
  memberHooks: {
    onInvite: async ({ qb, after }) => {
      if (await isBlocked(after?.email))
        throw new MemberHookError("We cannot invite that address.");
      await createHostAccount(qb, after);
    },
    onRoleChange: ({ before, after }) => syncHostRole(before, after),
  },
});
```

| Hook             | After                                        |
| ---------------- | -------------------------------------------- |
| `onInvite`       | `inviteMember`                               |
| `onAccept`       | `acceptInvitation`                           |
| `onRoleChange`   | `updateMembership` changed the role          |
| `onStatusChange` | `updateMembership` changed the status        |
| `onUpdate`       | every `updateMembership`, member details too |
| `onRemove`       | `removeMember`                               |

Each hook gets `{ action, qb, ctx, before, after }`. It runs after the write, in the same transaction: `qb` is bound to it, and a throw undoes the change. Throw `MemberHookError` (400) to show its message on the Members page. Other errors fail the server action. The Members page calls the helpers, so the hooks run there. Direct writes to `memberships` (imports, `qb.update`) do not run them. Send email from a hook only when it cannot throw afterwards, or from an `afterCommit` hook.

`before` is a snapshot read without a row lock. Concurrent edits are not serialized: use `onUpdate` for idempotent synchronization, or serialize host transactions when every role/status transition must be observed.

Invitations by email need a verified address. Set `emailVerified` on the user in your auth adapter: with `emailVerified: false`, `acceptInvitation` throws `ForbiddenError`, and `listMyInvitations` and membership reads ignore the email. Invitations by user id do not check it. When the field is missing, the email is trusted, so return only verified addresses in `email`.

## Helpers

All take `(qb, ctx, …)` and go through the local API, so access rules apply.

| Helper                                     | Returns                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `resolveTenant(qb, ctx)`                   | `Tenant`: organization, membership, role, capabilities, modules. |
| `hasCapability(qb, ctx, capability)`       | `boolean`                                                        |
| `canUseModule(qb, ctx, key)`               | `boolean`                                                        |
| `listMyOrganizations(qb, ctx)`             | Active memberships with their organization, by name.             |
| `listMyInvitations(qb, ctx)`               | Pending invitations for the user's id or email.                  |
| `inviteMember(qb, ctx, input)`             | New membership with status `invited`.                            |
| `acceptInvitation(qb, ctx, id)`            | The membership, now `active`.                                    |
| `updateMembership(qb, ctx, id, patch)`     | Changed `role`, `status`, `modules` or added `fields`.           |
| `removeMember(qb, ctx, id)`                | The deleted membership.                                          |
| `canManageMember(qb, ctx, membership)`     | `boolean`: may the user change (or `"remove"`) this member.      |
| `migrateEmptyModules(qb)`                  | Number of memberships set from `[]` to `["*"]`.                  |
| `switchOrganization(qb, ctx, id)`          | `{ organizationId, tenant, cookie, setCookie }`.                 |
| `organizationCookie(qb, id \| null, req?)` | Cookie to set or clear the selection.                            |
| `getTenancy(qb)`                           | Resolved options: roles, cookie and header names.                |

Switching in a Next.js server action:

```ts
"use server";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { switchOrganization } from "@quickben/plugin-tenancy";
import { cookies } from "next/headers";

export async function selectOrganization(id: string) {
  const qb = await getQuickben(config);
  const { cookie } = await switchOrganization(qb, await getRequestContext(config), id);
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}
```

Route handlers and pages pass the request in `ctx`, so the cookie and header are read without extra code.

The cookie is `HttpOnly`, `SameSite=Lax` and `Path=/`. It is `Secure` when the request is https (`x-forwarded-proto`, else the request URL), so it also works on `http://localhost`. `organizationCookie(qb, id, req)` without `req` always sets `Secure`. `isSecureRequest(req)` is the check.

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

Fields added to `organizations` and `memberships` with `addFields` show in the settings form and in a **Details** dialog per member, with the generic admin inputs and field access. `admin: { hidden: true }` leaves a field out.

`sections` adds tabs to the settings page at `<basePath>/organization/<key>`. Each is a server component that gets `OrganizationSectionProps` (`organization`, `tenant`, `segments`, `i18n`, `serverFunction`, …) and can use its own server actions:

```tsx
tenancyAdmin(config, {
  sections: [
    { key: "billing", label: "Billing", component: BillingSection, visible: (t) => t.platform },
  ],
});
```

Pass `basePath` when the admin is not at `/admin`. Actions redirect with a code (`?toast=member-updated`, `?error=last-owner`). The pages map codes to fixed messages and ignore unknown codes, so the URL never puts text on the page. The message of a `MemberHookError` goes through a cookie (`quickben-tenancy-notice`, 60 seconds) and shows with `?error=hook`. `@quickben/admin`, `@quickben/next`, `next` and `react` are needed only for this entry.

Server actions find the config through a registry filled when the page module loads. After a restart, a form submitted from an open tab can fail once; reload the page.

### Switcher in your own layout

With `chrome: "none"` the admin renders no sidebar. Put the switcher in your layout:

```tsx
import { createOrganizationSwitcher } from "@quickben/plugin-tenancy/admin";

const OrganizationSwitcher = createOrganizationSwitcher(config, { basePath: "/admin" });

// In a server layout:
<OrganizationSwitcher />;
```

It is a server component. It uses the locale of `getAdminI18n(config)`; pass `i18n` to use another translator. Use the same `basePath` as `createAdminPage`. Texts are in the `tenancy` namespace (`tenancyMessages`), so `admin.messages` can override them.
