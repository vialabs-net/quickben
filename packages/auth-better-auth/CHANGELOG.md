# @quickben/auth-better-auth

## 0.2.0

### Patch Changes

- @quickben/core@0.2.0

## 0.1.0

### Minor Changes

- a259198: New `@quickben/auth-firebase` 0.1.0: auth adapter for Firebase session cookies, a session route (create from an ID token, read, clear; CSRF-checked), roles from custom claims or a resolver, a browser client (Google popup, One Tap, email and password), a session keeper that reloads tabs when the account changes, and a sign-in page (`@quickben/auth-firebase/admin`).
  
  New `@quickben/auth-better-auth` 0.1.0: auth adapter that reads the Better Auth session, with the organization plugin's active organization and member roles, `tenancySync` hooks that mirror Better Auth organizations into `@quickben/plugin-tenancy`, and `withActiveOrganizationCookie` that keeps the tenancy cookie on Better Auth's active organization.

### Patch Changes

- Updated dependencies [e70ef29]
- Updated dependencies [d62a1a8]
- Updated dependencies [811793e]
- Updated dependencies [991ab37]
- Updated dependencies [745dd01]
- Updated dependencies [eb5c707]
  - @quickben/core@0.1.0
