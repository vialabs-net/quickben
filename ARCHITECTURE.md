# Quickben architecture

Quickben is a Next.js-native framework for business apps. You declare **collections** (typed data with fields, access rules and hooks) in one config. Quickben gives you a typed server API, REST route handlers, an admin UI and plugins such as multi-tenancy, on your own database.

Payload CMS is the reference for intent: code-first config, admin generated from config, a local API, plugins. Quickben has fewer concepts: plain objects and functions, no custom bundler, no global state beyond one cached instance per config.

It is the open-source foundation under real products. The first is a private multi-tenant CRM. Anything generic belongs here: tenancy, users and access, admin shell, settings, integrations (connections and credentials), document templates, document reading, release tooling. A product only adds its domain collections and screens.

This file describes what exists. Sections marked **Planned** describe agreed design that is not built yet.

## Principles

1. **One config, full inference.** `defineConfig({ db, collections, plugins, auth, admin })` in `quickben.config.ts`. Document, input and filter types are inferred from field definitions. No code generation for types.
2. **Storage-agnostic core.** `@quickben/core` never imports a database library. Adapters implement a small `DatabaseAdapter` interface with a portable query model. Relational and document stores can both implement it. Adapters expose their native client for custom queries.
3. **Next.js App Router native.** Two catch-all files wire everything (see [Next.js integration](#nextjs-integration)).
4. **Small surface, plain objects.** Collections, fields, access, hooks, plugins, modules, nav. Each is a plain object or function, with a `define*` helper where inference needs one.
5. **Secure by default.** Without an access rule only authenticated users get access. The local API enforces access unless `overrideAccess: true`. Input is validated with Zod schemas generated from fields.
6. **Monorepo, small packages, independent tests.** pnpm workspaces, Turborepo, Changesets. ESM only, TypeScript strict, `exports` maps, tsdown builds, Vitest.

## Repository

| Path                       | Package                                     | Status |
| -------------------------- | ------------------------------------------- | ------ |
| `packages/core`            | `@quickben/core`                            | Exists |
| `packages/db-memory`       | `@quickben/db-memory`                       | Exists |
| `packages/adapter-tests`   | `@quickben/adapter-tests` (private)         | Exists |
| `tooling/tsconfig`         | `@quickben/tsconfig` (private)              | Exists |
| `tooling/eslint-config`    | `@quickben/eslint-config` (private)         | Exists |
| `packages/db-drizzle`      | `@quickben/db-drizzle`                      | Exists |
| `packages/next`            | `@quickben/next`                            | Exists |
| `packages/admin`           | `@quickben/admin`                           | Exists |
| `packages/plugin-tenancy`  | `@quickben/plugin-tenancy`                  | Exists |
| `packages/create-quickben` | `create-quickben`                           | Exists |
| `apps/docs`                | Nextra site at https://quickben.vialabs.net | Exists |
| `apps/playground`          | Next.js app using everything (PGlite)       | Exists |

Dependencies point one way: adapters and other packages depend on `@quickben/core` (as a peer dependency). Core depends only on Zod.

### Tooling

| Tool       | Version                          | Notes                                                                                                                |
| ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Node.js    | ≥ 22.18 (CI: 22 and 24, dev: 24) |                                                                                                                      |
| pnpm       | 12                               | Pinned in `packageManager`. Use Corepack.                                                                            |
| TypeScript | 6.0                              | typescript-eslint and eslint-plugin-sonarjs do not support TypeScript 7 yet.                                         |
| ESLint     | 10                               | Flat config in `tooling/eslint-config`: typescript-eslint strict type-checked, sonarjs, import-x (order, no cycles). |
| tsdown     | 0.23                             | ESM + `.d.ts`, `publint` on every build.                                                                             |
| Vitest     | 5                                | Type tests (`*.test-d.ts`) run with the unit tests.                                                                  |

TypeScript presets use `moduleResolution: "bundler"`. Packages are bundled by tsdown and apps by Next.js, so source imports have no `.js` extensions and the published output is plain Node ESM with an `exports` map (`types` + `default`).

## Core concepts

### Collections and fields

```ts
const posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    status: f.select({ options: ["draft", "published"], required: true, default: "draft" }),
    author: f.relation({ to: "users" }),
    tags: f.relation({ to: "tags", many: true }),
    publishedAt: f.datetime(),
    meta: f.json({ schema: z.object({ noIndex: z.boolean() }) }),
  },
  access: { read: () => true, update: ({ user }) => (user ? { author: { eq: user.id } } : false) },
  hooks: { beforeChange: [({ data }) => data] },
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "publishedAt"] },
});
```

| Field              | Stored value                              | Options beyond the common ones        |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| `text`, `textarea` | string                                    | `minLength`, `maxLength`              |
| `email`            | string                                    | `minLength`, `maxLength`              |
| `url`              | string (`http`/`https` only)              | `minLength`, `maxLength`              |
| `number`           | number                                    | `integer`, `min`, `max`               |
| `boolean`          | boolean                                   |                                       |
| `date`             | `"YYYY-MM-DD"`                            | input also accepts `Date`             |
| `datetime`         | ISO 8601 UTC string                       | input also accepts `Date` and offsets |
| `select`           | one option, or an array with `many: true` | `options`, `many`                     |
| `relation`         | id, or ids with `many: true`              | `to`, `many`                          |
| `json`             | JSON value                                | `schema` (Zod) types and validates it |

Common options: `required`, `unique`, `index`, `default` (value or function), `label`, `description`, `validate`, `admin { hidden, readOnly, width, component }`. `component` names a custom admin input (see `@quickben/admin`); core stores only the name.

Rules:

- Every document has `id`, `createdAt` and `updatedAt` (ISO strings).
- `required` fields are never `null`. Other fields are `null` when unset.
- `many` fields are arrays, never `null` (`[]` when unset). `required` on a `many` field means at least one value. Values must be unique within the array.
- `default` makes a field optional on create.
- Slugs: lowercase letters, digits, `-`, `_`. Field names: letters, digits, `_`, unique without case (SQLite columns ignore case). `id`, `createdAt`, `updatedAt`, `and`, `or` are reserved, also in other cases.
- Labels default to the humanized slug and field name.

### Type inference

| Type                           | Shape                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `InferDoc<typeof posts>`       | System fields + every field (`T`, `T \| null` or `T[]`).                             |
| `InferCreateInput<…>`          | Required fields without default are required. `id` is optional. Dates accept `Date`. |
| `InferUpdateInput<…>`          | Every field optional. Only non-required fields accept `null`.                        |
| `InferWhere<…>`                | Per-field operators that depend on the field type.                                   |
| `InferSort<…>`                 | `"field"`, `"-field"` or an array of them.                                           |
| `InferRegistry<typeof config>` | Collections keyed by slug, including collections added by plugins.                   |

`getQuickben(config)` returns `Quickben<Registry>`: `qb.find("posts", …)` checks the slug, the filter, `select` and `depth`, and types the result. `select: ["title"]` narrows documents to `{ id, title }`. `depth: 1` types relations as `string | RelatedDoc`.

Fields that plugins add with `definePlugin({ addFields })` are inferred. Fields added inside `extendCollections` exist at runtime only.

### Validation

- Core builds a Zod 4 schema per collection for create and for update. Unknown keys are rejected.
- Field `validate(value, { operation, data, original, user })` runs after the schema, for values that are not `null`. It returns `true` or an error message.
- Related ids must exist and be readable by the user (`overrideAccess`: exist). Ids an update keeps from the stored document are not checked again. Core checks them with one query per related collection.
- Unique values are enforced by the adapter, which throws `ConflictError`.
- Errors are `ValidationError` with `issues: { path, message }[]`.

### Query model

```ts
qb.find(
  "posts",
  {
    where: { or: [{ status: { eq: "draft" } }, { views: { gte: 10 } }] },
    sort: ["-publishedAt", "title"],
    limit: 20,
    page: 2, // or: cursor: previous.nextCursor
    select: ["title", "status"],
    depth: 1,
  },
  { user },
);
```

| Operator                            | Fields                                                 | Matches `null`?      |
| ----------------------------------- | ------------------------------------------------------ | -------------------- |
| `eq`, `in`                          | single-value fields except `json`                      | no                   |
| `ne`, `notIn`                       | single-value fields except `json`                      | yes                  |
| `lt`, `lte`, `gt`, `gte`            | text, number, date, datetime, timestamps               | no                   |
| `contains`, `startsWith`            | text-like (case-insensitive)                           | no                   |
| `exists`                            | all                                                    | `exists: false` does |
| `contains`, `in`, `notIn`, `exists` | `many` fields: has value, has any, has none, not empty | —                    |

- Keys in one object are combined with AND. `and: []` matches all, `or: []` matches nothing.
- `contains` and `startsWith` ignore case for ASCII letters only on SQLite (`LIKE`). The contract suite marks the non-ASCII test as expected to fail there (`asciiCaseOnly`).
- Sort: default `-createdAt`. Core always appends `id` (same direction as the last key), so the order is total. Nulls sort last ascending and first descending. Text order follows the store's collation.
- Page mode (`limit` + `page`, default limit 20) returns `totalDocs` and `totalPages`. Cursor mode (`cursor`) skips the count; `page`, `totalDocs` and `totalPages` are `null`. Both return `hasNextPage` and `nextCursor`.
- Cursors are keyset positions encoded by core. Core turns a cursor into a plain `where` filter, so adapters do not implement cursors. A cursor only works with the sort it was made for.
- Core validates every filter against the collection and normalizes it to a `WhereNode` tree before an adapter sees it. `matchesWhere(doc, node)` is the reference implementation.

### Database adapter contract

```ts
interface DatabaseAdapter<TRaw = unknown> {
  readonly name: string;
  readonly raw: TRaw; // native client for custom queries
  init(schema: DatabaseSchema): Promise<void>;
  find(args: FindArgs): Promise<DocumentData[]>; // where, sort, limit, offset, select
  findOne(args): Promise<DocumentData | null>;
  count(args): Promise<number>;
  create(args): Promise<DocumentData>;
  update(args): Promise<DocumentData | null>;
  delete(args): Promise<boolean>;
  transaction<T>(fn: (tx: DatabaseAdapter<TRaw>) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
```

- Ids are strings. Core generates UUIDv7 ids when the input has none (custom ids are kept), so generated ids from one process sort by creation time in every store.
- No joins. Relations are stored as ids; core loads related documents (`depth` 0–3, one query per related collection and level). Missing or unreadable related documents stay ids.
- Adapters return values as core wrote them. Dates are ISO strings.
- Adapters throw `ConflictError` for taken unique values or ids. `null` never conflicts.
- `transaction(fn)` gives `fn` an adapter bound to the transaction. Calling `transaction` on it joins the same transaction.
- `@quickben/adapter-tests` exports `runAdapterContractTests(createAdapter)`. Every adapter runs it.

### Local API

```ts
const qb = await getQuickben(config); // cached per config object, on globalThis
await qb.find(slug, query, ctx);
await qb.findById(slug, id, { depth, select }, ctx);
await qb.count(slug, { where }, ctx);
await qb.create(slug, data, ctx);
await qb.update(slug, id, data, ctx);
await qb.delete(slug, id, ctx);
await qb.transaction(async (tx) => {
  /* tx has the same methods */
});
qb.collections.posts; // collection metadata
qb.db.raw; // native client
```

`ctx` is `{ user, req?, overrideAccess? }`, is required and is always the last argument (never merged with query options). `createQuickben(config)` calls `db.init(schema)`, then each plugin's `onInit`. `getQuickben` drops a failed instance so the next call retries.

Writes (`create`, `update`, `delete`) run in one transaction together with their hooks. If a hook throws, nothing is written.

**create:** access → defaults → `beforeValidate` → validation → related ids → `beforeChange` → access filter on the new document → write → `afterChange` → `afterRead`.

**update:** load (needs read access; unreadable = `NOT_FOUND`) → access (filter must match the stored document) → `beforeValidate` → validation → related ids → `beforeChange` → access filter on the updated document → write → `afterChange` → `afterRead`.

**delete:** load (needs read access; unreadable = `NOT_FOUND`) → access (filter must match) → `beforeDelete` → delete → `afterDelete` → `afterRead`. Documents that reference the deleted one keep its id.

**reads:** access filter AND query → adapter → relations → `afterRead` → `select`. When a collection has `afterRead` hooks, core loads full documents and applies `select` after the hooks.

### Access

| Operation | Rule returns `true` | Rule returns a filter                                                        |
| --------- | ------------------- | ---------------------------------------------------------------------------- |
| `read`    | all documents       | AND-ed with the query. `findById` of a filtered-out document is `NOT_FOUND`. |
| `create`  | allowed             | The new document (after hooks) must match.                                   |
| `update`  | allowed             | The stored document and the updated document must match.                     |
| `delete`  | allowed             | The stored document must match.                                              |

`false` throws `UnauthorizedError` without a user and `ForbiddenError` with one. A missing rule allows authenticated users only. Rules receive `{ user, req, ctx, qb, operation, id, data }`. `ctx` is the whole request context, including keys added by plugins. `qb` is the local API bound to the current transaction; it is `undefined` when UI code calls `checkAccess` itself.

`checkAccess(collection, operation, ctx)` evaluates a rule without touching data and returns `true`, `false` or a normalized filter. The HTTP layer and the admin use it to decide what to show.

### Hooks

Arrays per stage, run in order. Each gets `{ user, req, ctx, qb, collection }` plus stage data. `qb` is bound to the current transaction.

| Hook             | Extra arguments                                 | Return                   |
| ---------------- | ----------------------------------------------- | ------------------------ |
| `beforeValidate` | `operation`, `data` (not validated), `original` | new data or nothing      |
| `beforeChange`   | `operation`, `data` (validated), `original`     | new data or nothing      |
| `afterChange`    | `operation`, `doc`, `original`                  | nothing                  |
| `afterRead`      | `doc`                                           | new document or nothing  |
| `beforeDelete`   | `id`, `doc`                                     | nothing; throw to cancel |
| `afterDelete`    | `id`, `doc`                                     | nothing                  |

### Plugins and modules

A plugin is `(config: PluginConfig) => PluginConfig`. `defineConfig` applies plugins in the order listed, then validates the result (unique slugs, known relation targets, known module collections).

```ts
const audit = definePlugin({
  name: "audit",
  collections: [auditLog], // added first; typed in the registry
  addFields: { posts: { reviewedBy: fields.text() } }, // then fields on existing collections; typed
  extendCollections: (cs) => cs.map((c) => extendCollection(c, { hooks: { afterChange: [log] } })),
  modules: [{ key: "audit", label: "Audit", collections: ["audit-log"] }],
  onInit: async (qb) => {}, // after the database is ready
});
```

- `definePlugin` throws if the same plugin is applied twice. `addFields` throws for an unknown slug.
- Registry types: `Plugin<Added, Extends>` carries added collections and added fields (keyed by slug) at type level; `defineConfig` merges them into the registry.
- `extendCollection(collection, { fields, hooks })` returns a copy; new hooks run after existing ones.
- **Modules** (`{ key, label, collections, nav }`) group collections into feature areas. They are carried in `config.modules` for the admin sidebar and for tenancy entitlements.

### Auth

```ts
interface AuthAdapter {
  getUser(req: Request): Promise<QuickbenUser | null>;
}
interface QuickbenUser {
  id: string;
  email?: string;
  emailVerified?: boolean; // false: features that trust the email refuse it
  roles?: string[];
}
```

Extend `QuickbenUser` with declaration merging. Auth adapters should set `emailVerified`; `false` stops email-based features such as accepting tenancy invitations by email. `devAuth()` reads the user from the `x-quickben-user` header or the `QUICKBEN_DEV_USER` variable (an id or JSON). It throws when `NODE_ENV` is `production` unless `allowInProduction: true`. Core stores no passwords. **Planned:** recipes for Better Auth and Firebase.

### Errors

All errors extend `QuickbenError` with a stable `code` and a suggested HTTP `status`: `VALIDATION` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `CONFIG` 500.

### Drizzle adapter (`@quickben/db-drizzle`)

```ts
import { drizzleAdapter } from "@quickben/db-drizzle/postgres"; // or /pglite, /sqlite

drizzleAdapter({ url }); // node-postgres
drizzleAdapter({ dataDir }); // /pglite: in memory without dataDir
drizzleAdapter({ url }); // /sqlite: libSQL; :memory: by default
```

- One entry point per dialect, so a bundler resolves only the driver the app imports. The main entry has the types and schema tools.

- `init` builds one Drizzle table per collection (table = slug, column = field name). `push` creates missing tables, columns and indexes; it is on by default for in-memory databases.
- `quickben-drizzle generate` (or `generateDrizzleSchema(config, { out })`) writes the same tables as a TypeScript schema file for drizzle-kit migrations.
- `raw` is `{ dialect, db, tables, table(slug) }`. Inside a transaction `db` is the Drizzle transaction.
- Postgres stores datetimes as `timestamp(3) with time zone` and `many` fields as `text[]`. SQLite stores datetimes as ISO text and `many` fields as JSON arrays.
- PGlite and local SQLite have one connection, so operations run one at a time.

## Next.js integration

```ts
// app/api/[...quickben]/route.ts
export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config);

// app/admin/[[...segments]]/page.tsx
async function serverFunction(request: AdminRequest) {
  "use server";
  return handleAdminRequest(config, request);
}
export default createAdminPage(config, { serverFunction }); // async server component
```

### `@quickben/next`

- Route handlers: `GET /_meta`, `GET|POST /:collection`, `GET|PATCH|DELETE /:collection/:id`. They take plain `Request` objects, so tests call them directly.
- Query string: `where` is JSON; `sort` and `select` are comma-separated; `limit` (≤ `maxLimit`, default 100), `page`, `cursor`, `depth`. Unknown parameters are rejected.
- Bodies: JSON objects only, at most `maxBodyBytes` (default 1 MB); `id`, `createdAt`, `updatedAt` are removed.
- Errors: `{ error: { code, message, details } }` with the status of the error. HTTP-only codes: `METHOD_NOT_ALLOWED` 405, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `INTERNAL` 500 (message hidden, error logged; also for 5xx Quickben errors such as `CONFIG`).
- CSRF: `POST`, `PATCH` and `DELETE` require a same-origin `Origin` (or a trusted one) when the browser sends one, and reject `Sec-Fetch-Site: cross-site`.
- Server helpers: `getRequestContext` / `getUser` resolve the user from `next/headers`, `singleton(key, create)` keeps database clients per process. No `next.config` wrapper.

### `@quickben/admin`

- `createAdminPage(config, options)` returns one async server component that renders the shell, dashboard, list, create and edit views and custom pages. Data is loaded on the server with the local API and the current user.
- Writes and relation searches go through one server function (`AdminRequest` → `AdminResult`). It must be defined in the app's page file so Next.js can load the config when it runs; the built-in fallback only works after the page module has loaded in the process.
- Client components: form (submit, errors, focus), relation picker, JSON editor, delete confirmation, toast. Everything else is server-rendered.
- Extensions: `components` (custom field inputs, chosen by `admin.component`), `views` (per collection), `pages`, `nav`, `sidebar` (components at the top of the sidebar), and `extensions` from plugins.
- Styles: Tailwind v4 with the `qb:` prefix, compiled into `@quickben/admin/styles.css`; base styles only inside `.qb-root`, in `@layer base`. Utilities are unlayered, so unlayered app resets do not override them.
- Cache Components: `createAdminPage` renders its content inside `<Suspense>`. `generateAdminMetadata(config)` gives the page title (`admin.meta`).
- Build: tsdown `unbundle` keeps one file per module so `"use client"` / `"use server"` directives stay at the top of the published files.

### `@quickben/plugin-tenancy`

- `tenancy({ scope })` adds `organizations` and `memberships` (invitations are memberships with status `invited`), and an `organization` relation (required, indexed, optional in create input) to each scoped collection via `addFields`.
- Scoped access: the collection's rule AND `{ organization: { eq: active } }`; creates get the active organization; documents cannot move (platform staff with no organization selected can move them). Relations can only point to documents of the active organization. Members of a suspended organization can read it and its memberships, nothing else. Reads need the `read` capability, writes `write`; collections in a module need the module.
- Active organization: `ctx.organizationId`, then a header, then a cookie (`Secure` only on https), then the user's only membership; verified against active memberships. Platform staff (`isPlatformAdmin`) see all organizations or act in one. `OrganizationError` (403) carries a `reason`.
- Roles are data: capabilities per role, ranked by order. Membership hooks enforce the guard rails (`TenancyRuleError` with a `rule`): last active owner, no self-demotion for owners and admins, no managing higher roles. Invitations by email need `emailVerified` not `false`.
- Helpers over the local API: `resolveTenant`, `inviteMember`, `acceptInvitation`, `updateMembership`, `removeMember`, `listMyOrganizations`, `listMyInvitations`, `switchOrganization` (returns the cookie), `canUseModule`, `moduleAccess`, `hasCapability`.
- `@quickben/plugin-tenancy/admin`: `tenancyAdmin(config)` is an admin extension with an organization switcher, a Members page and an Organization settings page. Server actions use a registry keyed by base path, like the admin's default server function. They redirect with `?toast=` / `?error=` codes that the pages map to fixed messages.

## create-quickben

`pnpm create quickben my-app` writes a Next.js app with the two catch-all routes, `lib/db.ts` for the chosen database and `lib/auth.ts` (`devAuth()` in development, anonymous in production).

- Templates are layers in `packages/create-quickben/templates`: `base`, `db/<db>`, `example/<example>`. `package.json` files are merged.
- Templates use `workspace:^` for `@quickben/*`. The build copies them to `dist/templates` with the current versions, so a release installs matching packages.
- `next.config.ts` turns on Cache Components. The pglite layer adds `@electric-sql/pglite` to `serverExternalPackages`.
- Changesets releases `create-quickben` and the public `@quickben/*` packages as one `fixed` group, so their versions always match.
- CI job `create-quickben scaffold` installs a generated app from `pnpm pack` tarballs and runs `next build` and `next start`.

## Quality

- TypeScript strict, no `any` in public types, no circular imports.
- Each package: Vitest unit tests, at least 85 % line coverage (enforced), builds to `dist`.
- CI (`.github/workflows/ci.yml`): format, lint, typecheck, tests with coverage, build on Node 22 and 24.
- SonarCloud (`.github/workflows/sonar.yml`, project `vialabs-net_quickben`): lcov from every package; the quality gate must pass.
- Changesets for versions. `.github/workflows/release.yml` publishes to npm only when the `NPM_TOKEN` secret exists.
