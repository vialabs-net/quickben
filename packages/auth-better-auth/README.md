# @quickben/auth-better-auth

[Better Auth](https://www.better-auth.com) for [Quickben](https://quickben.vialabs.net): an auth adapter that reads the Better Auth session.

```sh
pnpm add @quickben/auth-better-auth better-auth
```

```ts
import { betterAuthAdapter } from "@quickben/auth-better-auth";

import { auth } from "./lib/auth"; // your betterAuth({ … })

export default defineConfig({ db, collections, auth: betterAuthAdapter({ auth }) });
```

## Exports

| Export                                  | Purpose                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `betterAuthAdapter({ auth, … })`        | `AuthAdapter` over `auth.api.getSession({ headers })`.                                                 |
| `tenancySync({ qb, mapRole })`          | Better Auth `organizationHooks` that mirror organizations and members into `@quickben/plugin-tenancy`. |
| `withActiveOrganizationCookie(handler)` | Wraps Better Auth's `POST` handler so tenancy's organization cookie follows the active organization.   |

## User mapping

| `QuickbenUser`         | From                                                 |
| ---------------------- | ---------------------------------------------------- |
| `id`, `email`          | `user.id`, `user.email`                              |
| `emailVerified`        | `user.emailVerified`                                 |
| `roles`                | `user.role` (admin plugin), or the `roles` option    |
| `activeOrganizationId` | `session.activeOrganizationId` (organization plugin) |
| `organizationRoles`    | active member's role, with `memberRoles: true`       |

Docs: https://quickben.vialabs.net/docs/auth/better-auth
