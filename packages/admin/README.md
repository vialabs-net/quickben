# @quickben/admin

Admin UI for [Quickben](https://quickben.vialabs.net), generated from your collections. React Server Components, one server function for writes, Tailwind CSS v4.

```sh
pnpm add @quickben/admin @quickben/next
```

## Setup

```tsx
// app/admin/[[...segments]]/page.tsx
import { createAdminPage, handleAdminRequest } from "@quickben/admin";
import type { AdminRequest } from "@quickben/admin";

import config from "@/quickben.config";

async function serverFunction(request: AdminRequest) {
  "use server";
  return handleAdminRequest(config, request);
}

export default createAdminPage(config, { serverFunction });
```

```tsx
// app/admin/layout.tsx
import "@quickben/admin/styles.css";
import { generateAdminMetadata } from "@quickben/admin";

import config from "@/quickben.config";

// Title `Admin · <admin.title>`, or `admin.meta.title`. Not indexed.
export const metadata = generateAdminMetadata(config);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`export default createAdminPage(config)` alone also works. Then the admin uses a built-in server function that finds the config once the page module has loaded. After a restart, or on a new serverless instance, a form submitted from an open tab can arrive first and fail with "Reload the page". Define `serverFunction` in the page file for production: Next.js then loads your config with it.

The page renders its content inside `<Suspense>`, so it works with and without `cacheComponents: true`.

## Routes

| Path                     | View                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `/admin`                 | Dashboard: readable collections with counts, grouped like the sidebar. |
| `/admin/:collection`     | List: columns, search, filters, sort, pagination.                      |
| `/admin/:collection/new` | Create form.                                                           |
| `/admin/:collection/:id` | Edit form, details, delete.                                            |
| `/admin/:page/...`       | Custom pages.                                                          |

Every read and write goes through the local API with the user from `config.auth`. The sidebar and dashboard show only collections the user can read. Forms are read-only without update access; "New" and "Delete" appear only with create and delete access.

### List

| Feature    | Source                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| Columns    | `admin.defaultColumns`, else the title field and the next three simple fields. |
| Search     | `contains` on `admin.useAsTitle` when it is a text field. `?q=`                |
| Filters    | Visible `select` and `boolean` fields. `?filter.status=draft`                  |
| Sort       | Click a column header. `?sort=-title`                                          |
| Pagination | `?page=2&limit=50` (10, 20, 50, 100)                                           |

Relation columns show the title of the related document.

### Forms

| Field type                 | Input                                                         |
| -------------------------- | ------------------------------------------------------------- |
| text, email, url           | `<input>` of that type, with length limits                    |
| textarea                   | `<textarea>`                                                  |
| number                     | `<input type="number">`, `step` 1 for integers                |
| boolean                    | checkbox                                                      |
| date / datetime            | `date` / `datetime-local` input in the admin time zone        |
| select / select `many`     | `<select>` / checkbox group                                   |
| relation / relation `many` | search box with keyboard support, chips for many              |
| json                       | textarea with live syntax check and Format button             |
| json with a list schema    | Row editor: add, remove, reorder rows; raw JSON toggle        |
| file                       | file input, size check, image or PDF preview, remove checkbox |

Field options: `admin.hidden` (not rendered, not sent), `admin.readOnly` (shown disabled, not sent), field `access.read` denied (not in lists, filters or forms), `access.create` / `access.update` denied (shown disabled, not sent), `admin.width` (`full`, `half`, `third`), `description` (hint text). Validation errors from the local API are shown next to their field; the first invalid field gets focus. File previews and links use `GET <apiBasePath>/:collection/:id/:field` (option `apiBasePath`, default `/api`). Uploads go through the server function: raise `experimental.serverActions.bodySizeLimit` for files over 1 MB.

### List of objects in a json field

A `json` field whose `schema` is an array of objects with string, number, boolean or enum properties gets a row editor instead of JSON text. `FieldMeta.rows` (from `jsonRowColumns`) lists the columns.

```ts
models: f.json({
  schema: z.array(
    z.object({
      id: z.string().min(1),
      inputPerMTokUsd: z.number().min(0).default(0).meta({ title: "Input USD / 1M" }),
      vision: z.boolean().default(false),
    }),
  ),
}),
```

| Feature     | Behavior                                                                   |
| ----------- | -------------------------------------------------------------------------- |
| Columns     | One input per property; the label is `.meta({ title })`, else the key.     |
| Rows        | Add, remove, move up and down. Keyboard focus follows the row.             |
| Empty cells | Optional cells are left out, so schema defaults apply.                     |
| Errors      | Issues like `models.1.id` show on the cell and focus it.                   |
| Raw JSON    | "Edit as JSON" toggles a JSON editor; values that are not rows open in it. |
| Other keys  | Properties without a column are kept.                                      |

## Extensions

```tsx
export default createAdminPage(config, {
  serverFunction,
  components: { color: ColorInput }, // fields pick one: admin: { component: "color" }
  views: { posts: { list: PostBoard } }, // replace the list or edit view of a collection
  pages: [{ path: "reports", label: "Reports", component: Reports }],
  nav: [{ label: "Docs", href: "https://quickben.vialabs.net", group: "Help" }],
  sidebar: [TeamPicker], // shown at the top of the sidebar
  extensions: [tenancyAdmin(config)], // same shape, from plugins; applied first
  signInHref: "/sign-in",
});
```

| Option       | Props                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `components` | `FieldComponentProps`: `field`, `name`, `id`, `value`, `required`, `disabled`, `describedBy`, `i18n` |
| `views`      | `ViewProps`: `collection`, `user`, `basePath`, `searchParams`, `id?`, `i18n`                         |
| `pages`      | `PageProps`: `user`, `basePath`, `segments`, `searchParams`, `i18n`                                  |
| `sidebar`    | `SidebarProps`: `user`, `basePath`, `i18n`                                                           |
| `catalogs`   | Message bundles from `defineMessages`, one namespace each.                                           |

`i18n` is the translator (`AdminI18n`) in server components. Field components get its plain data (`AdminI18nData`). Page labels and groups accept a string, a per-locale record or `(i18n) => string`.

Props are plain data, so components can be server or client components. A custom field component renders controls named `name`; the value is read like the built-in input of that field type (JSON text for `json`).

Sidebar order: modules (their `nav`, or their collections), then other collections by `admin.group` (default "Collections"), then custom pages, then `nav` links.

## Languages

English is the default. A complete Spanish catalog (`es`) ships with the admin and every plugin.

```ts
defineConfig({
  // …
  admin: {
    locale: "es", // or a function of the request, see below
    messages: { es: { "admin.nav.dashboard": "Inicio" } }, // overrides by locale and key
    timeZone: "America/Santiago", // dates and times; default: the config `timeZone`
  },
});
```

| Setting    | Where                                       | Default                       |
| ---------- | ------------------------------------------- | ----------------------------- |
| `locale`   | `admin.locale` or `createAdminPage` options | `en`                          |
| `messages` | same                                        | none                          |
| `timeZone` | same                                        | config `timeZone`, then `UTC` |

- `locale` is a BCP 47 tag or `(req) => tag`. `localeFromRequest({ supported: ["en", "es"], cookie: "locale" })` from `@quickben/core` reads the cookie, then `Accept-Language`.
- Messages fall back from `es-CL` to `es` to English. Unknown keys show the key.
- Dates, numbers, lists and relative times use `Intl` with the active locale.
- Labels of collections, fields, modules and nav items can be per-locale records: `labels: { plural: { en: "Posts", es: "Entradas" } }`.
- `?toast=` and `?error=` codes in URLs map to catalog keys.
- `.qb-root` gets `lang`. For `<html lang>`, call `await getAdminLocale(config)` in a dynamic root layout, or set it from the same setting you pass to `admin.locale`.
- `handleAdminRequest(config, request, { locale, messages, timeZone })` takes the same options for error messages of saves.

**Your own messages** (custom pages, plugins):

```ts
import { defineMessages, missingMessages, useAdminI18n } from "@quickben/admin/i18n";

export const messages = defineMessages("reports", {
  en: { title: "Reports", count: { one: "{count} report", other: "{count} reports" } },
  es: { title: "Informes", count: { one: "{count} informe", other: "{count} informes" } },
});

// Server component: props.i18n.scope(messages).t("count", { count: 3 })
// Client component: useAdminI18n().scope(messages).t("title")
// Test: expect(missingMessages(messages)).toEqual([])
```

Every locale in `defineMessages` must have all English keys; the type checks it. Register the bundle with `catalogs: [messages]`. Admin keys are listed in `adminMessages` (`@quickben/admin/i18n`), namespace `admin`.

| Translator method                    | Output                                 |
| ------------------------------------ | -------------------------------------- |
| `t(key, values)`                     | message with `{name}` and plural forms |
| `text(label)`                        | a string or per-locale label           |
| `number`, `date`, `dateTime`, `list` | `Intl` formats                         |
| `relativeTime(value, now?)`          | `yesterday`, `in 2 hours`              |

## Embedded mode

`chrome: "none"` renders only the page, without sidebar and header, so admin and plugin pages sit inside your own layout at any `basePath`.

```tsx
// app/(app)/data/[[...segments]]/page.tsx
export default createAdminPage(config, { basePath: "/data", chrome: "none", serverFunction });

// app/(app)/layout.tsx: your header and navigation
const nav = await getAdminNav(config, { basePath: "/data" }, { pathname });
```

`getAdminNav` returns `{ title, basePath, dashboard, groups, current }`. Each link has `label`, `href`, `key`, `external` and `active`. Pass the same options as to `createAdminPage` so custom and plugin pages appear. Without `pathname`, mark the active link on the client (`usePathname()`). The organization switcher is `createOrganizationSwitcher` from `@quickben/plugin-tenancy/admin`.

### Page title in the host

With `pageTitle: "none"` the admin hides its own `<h1>` and breadcrumb (dashboard, collection pages, plugin pages). Descriptions and actions stay. Show the title in your layout from `getAdminNav(…, { pathname }).page`:

```tsx
const { page } = await getAdminNav(config, options, { pathname: "/data/posts/new" });
// { title: "New post", crumbs: [{ label: "Posts", href: "/data/posts" }, { label: "New" }] }
```

| Path                  | `page.title`     | `page.crumbs`            |
| --------------------- | ---------------- | ------------------------ |
| dashboard             | `admin.title`    | `[]`                     |
| `/:collection`        | plural label     | `[plural]`               |
| `/:collection/new`    | `New <singular>` | `[plural (link), New]`   |
| `/:collection/:id`    | document title   | `[plural (link), title]` |
| custom or plugin page | its nav label    | `[label]`                |
| unknown or outside    | `page` is `null` |                          |

Without `pathname`, `page` is absent. The playground's `app/embedded` renders it in the page file, where `params` give the path.

## Theme tokens

The admin and plugin pages read only these custom properties. Override them on `.qb-root` from unlayered CSS:

```css
.qb-root {
  --qb-accent: var(--brand-600);
  --qb-radius: 0.5rem;
  --qb-font-sans: "Inter", sans-serif;
}
```

| Token                                       | Use                                |
| ------------------------------------------- | ---------------------------------- |
| `--qb-surface`                              | cards, inputs, sidebar             |
| `--qb-surface-muted`                        | page background, table headers     |
| `--qb-text`, `--qb-text-muted`              | text, secondary text               |
| `--qb-border`                               | borders, dividers                  |
| `--qb-accent`, `--qb-accent-text`           | primary buttons, toasts            |
| `--qb-danger`, `--qb-danger-text`           | errors, delete buttons             |
| `--qb-success`, `--qb-warning`, `--qb-info` | badges and notices                 |
| `--qb-focus-ring`                           | focus outline                      |
| `--qb-radius`                               | control radius                     |
| `--qb-card-radius`                          | card radius (default radius + 2px) |
| `--qb-card-padding`                         | card and form padding (`1.25rem`)  |
| `--qb-title-size`, `--qb-title-weight`      | page titles (`1.5rem`, `600`)      |
| `--qb-heading-size`, `--qb-heading-weight`  | card titles (`0.875rem`, `600`)    |
| `--qb-table-row-height`                     | smallest table row (`2.5rem`)      |
| `--qb-font-sans`, `--qb-font-mono`          | fonts                              |

Tables scroll inside their own box, with shadows at the edges that can scroll, and never widen the page. Selects and relation chips fit their column; a cut label shows in full in the open list or as a tooltip.

Hover and soft shades are mixed from these with `color-mix()`. Defaults use `light-dark()`. `.qb-root` does not set `color-scheme`: it inherits the page's, so `:root { color-scheme: light dark }` follows the system.

## Styles

`@quickben/admin/styles.css` is built with Tailwind CSS v4. You do not need Tailwind in your app.

- Utilities use the `qb:` prefix and theme variables are `--qb-*`, so they do not clash with your own Tailwind classes.
- There is no global reset. Base styles apply inside `.qb-root`, the element that wraps the admin, in `@layer base`.
- Utilities are not in a layer, so an unlayered reset in your app (`* { margin: 0; padding: 0 }`) does not override them.
- If your app uses Tailwind v4 too, nothing needs to change. Its `@source` does not need to scan this package.
- Colors are semantic utilities that read the theme tokens: `qb:bg-surface`, `qb:text-fg-muted`, `qb:border-line`, `qb:bg-accent`, `qb:text-danger`, `qb:bg-success-soft`. They are all compiled, so custom components can use them.

The component kit is exported from `@quickben/admin/ui`: `Button`, `ButtonLink`, `Input`, `Textarea`, `Select`, `Checkbox`, `Label` (requires `htmlFor`), `Card`, `Badge`, `Table`, `Toast`. Use it in custom components to match the admin.

`@quickben/admin/forms` exports the generic field inputs for your own forms: `FieldInput`, `loadFieldContext`, `parseFormData`, `editableFields`, `formScope`. Custom pages get the admin `serverFunction` in `PageProps`; pass it to `loadFieldContext` for relation searches.

## Limits

- A document with the id `new` cannot be opened (the path is the create form).
- Validation messages from `@quickben/core` and from your `validate` functions are not translated.
