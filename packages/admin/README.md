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

| Field type                 | Input                                             |
| -------------------------- | ------------------------------------------------- |
| text, email, url           | `<input>` of that type, with length limits        |
| textarea                   | `<textarea>`                                      |
| number                     | `<input type="number">`, `step` 1 for integers    |
| boolean                    | checkbox                                          |
| date / datetime            | `date` / `datetime-local` input (UTC)             |
| select / select `many`     | `<select>` / checkbox group                       |
| relation / relation `many` | search box with keyboard support, chips for many  |
| json                       | textarea with live syntax check and Format button |

Field options: `admin.hidden` (not rendered, not sent), `admin.readOnly` (shown disabled, not sent), `admin.width` (`full`, `half`, `third`), `description` (hint text). Validation errors from the local API are shown next to their field; the first invalid field gets focus.

## Extensions

```tsx
export default createAdminPage(config, {
  serverFunction,
  components: { color: ColorInput }, // fields pick one: admin: { component: "color" }
  views: { posts: { list: PostBoard } }, // replace the list or edit view of a collection
  pages: [{ path: "reports", label: "Reports", component: Reports }],
  nav: [{ label: "Docs", href: "https://quickben.vialabs.net", group: "Help" }],
  extensions: [tenancyAdmin()], // same shape, from plugins; applied first
  signInHref: "/sign-in",
});
```

| Option       | Props                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| `components` | `FieldComponentProps`: `field`, `name`, `id`, `value`, `required`, `disabled`, `describedBy` |
| `views`      | `ViewProps`: `collection`, `user`, `basePath`, `searchParams`, `id?`                         |
| `pages`      | `PageProps`: `user`, `basePath`, `segments`, `searchParams`                                  |

Props are plain data, so components can be server or client components. A custom field component renders controls named `name`; the value is read like the built-in input of that field type (JSON text for `json`).

Sidebar order: modules (their `nav`, or their collections), then other collections by `admin.group` (default "Collections"), then custom pages, then `nav` links.

## Styles

`@quickben/admin/styles.css` is built with Tailwind CSS v4. You do not need Tailwind in your app.

- Utilities use the `qb:` prefix and theme variables are `--qb-*`, so they do not clash with your own Tailwind classes.
- There is no global reset. Base styles apply inside `.qb-root`, the element that wraps the admin, in `@layer base`.
- Utilities are not in a layer, so an unlayered reset in your app (`* { margin: 0; padding: 0 }`) does not override them.
- If your app uses Tailwind v4 too, nothing needs to change. Its `@source` does not need to scan this package.

The component kit is exported from `@quickben/admin/ui`: `Button`, `ButtonLink`, `Input`, `Textarea`, `Select`, `Checkbox`, `Label` (requires `htmlFor`), `Card`, `Badge`, `Table`, `Toast`. Use it in custom components to match the admin.

## Limits

- A document with the id `new` cannot be opened (the path is the create form).
- Datetimes are edited in UTC.
