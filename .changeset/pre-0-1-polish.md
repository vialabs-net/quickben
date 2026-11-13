---
"@quickben/core": minor
"@quickben/next": minor
"@quickben/admin": minor
"@quickben/plugin-tenancy": minor
"create-quickben": patch
---

Polish before 0.1.

- Next: `createRouteHandlers` limits `POST` and `PATCH` bodies to `maxBodyBytes` (default 1 MB). Larger bodies get `413 PAYLOAD_TOO_LARGE`.
- Next: `getQuickben` is no longer re-exported. Import it from `@quickben/core`.
- Admin: `resolveRoute` and `AdminRoute` are no longer exported.
- Core: `QuickbenUser.emailVerified`. Auth adapters should set it.
- Tenancy: `acceptInvitation` throws `ForbiddenError` for an invitation by email when the user has `emailVerified: false`. `listMyInvitations` and membership reads then ignore the email.
- Tenancy: the organization cookie is `Secure` only on https requests, so it works on `http://localhost`. `organizationCookie(qb, id, req)` takes the request; new `isSecureRequest(req)`.
- Tenancy: guard rails throw `TenancyRuleError` (a `ForbiddenError`) with a `rule`.
- Tenancy admin: actions redirect with `?toast=` and `?error=` codes that map to fixed messages. Text from the URL is never shown.
- create-quickben: templates import `getQuickben` from `@quickben/core`.
