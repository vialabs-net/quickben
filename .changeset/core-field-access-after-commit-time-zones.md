---
"@quickben/core": minor
"@quickben/next": minor
"@quickben/admin": minor
"@quickben/plugin-templates": patch
---

Field access rules, `afterCommit` hooks and time zones for date inputs.

- `@quickben/core`: field `access: { read, create, update }` returning booleans. Unreadable fields are removed from documents and `select` and rejected in `where` and `sort` (`ValidationError`). Input that sets an unwritable field throws `ForbiddenError` with `fields`. `checkFieldAccess`. `afterCommit` hooks run after the outermost transaction commits, with a non-transactional `qb`; errors are logged. `timeZone` in `defineConfig` and on `date`/`datetime` fields: `Date`, offset and offset-less inputs resolve in it (default `UTC`); the server time zone is never used. Strings in other formats are rejected in `where`. Helpers: `formatDateValue`, `zonedTimeToUtc`, `localDateTime`, `dateInTimeZone`, `isTimeZone`.
- `@quickben/next`: `/_meta` leaves out unreadable fields and gives each field `access: { create, update }` and date fields `timeZone`. `FORBIDDEN` from field rules has `details: { fields }`.
- `@quickben/admin`: unreadable fields are not shown; unwritable fields are read-only and not submitted. `datetime-local` inputs use the admin time zone, which defaults to the config `timeZone`. Message key `edit.utc` is now `edit.timeZone` (`{zone}`).
- `@quickben/plugin-templates`: dates are formatted with `formatDateValue`.
