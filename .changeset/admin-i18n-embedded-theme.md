---
"@quickben/core": minor
"@quickben/next": minor
"@quickben/admin": minor
"@quickben/plugin-tenancy": minor
"@quickben/plugin-templates": minor
"@quickben/plugin-doc-reader": minor
"@quickben/plugin-connections": minor
"@quickben/auth-firebase": minor
---

Admin languages, embedded mode and theme tokens.

- `@quickben/core`: `LocalizedText` labels (string or per-locale record) for collections, fields, modules, nav items and `admin.title`. `admin.locale`, `admin.messages`, `admin.timeZone`. `localize`, `negotiateLocale`, `localeFromRequest`.
- `@quickben/next`: `getMeta` and `collectionMeta` take `{ locale }` and return plain strings.
- `@quickben/admin`: `@quickben/admin/i18n` with `defineMessages`, `useAdminI18n`, `createAdminI18n`, `missingMessages`; English and Spanish catalogs. `i18n` in page, view and sidebar props. `chrome: "none"`, `getAdminNav`, `getAdminLocale`, `getAdminI18n`. Public `--qb-*` theme tokens with light and dark defaults.
- Plugins: every admin page uses its own message catalog (English and Spanish) and the theme tokens. `createOrganizationSwitcher` in `@quickben/plugin-tenancy/admin`.
