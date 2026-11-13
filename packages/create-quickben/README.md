# create-quickben

Create a Next.js app with [Quickben](https://quickben.vialabs.net).

```sh
pnpm create quickben my-app
npm create quickben@latest my-app
yarn create quickben my-app
bun create quickben my-app
```

The CLI asks for the options you did not pass. With `--yes`, or without a terminal, it uses the defaults.

## Options

| Option         | Values                                   | Default                     |
| -------------- | ---------------------------------------- | --------------------------- |
| `[directory]`  | Path of the new app                      | `quickben-app`              |
| `--db`         | `pglite`, `postgres`, `sqlite`, `memory` | `pglite`                    |
| `--example`    | `blank` (one collection), `blog`         | `blank`                     |
| `--pm`         | `pnpm`, `npm`, `yarn`, `bun`             | The one running the command |
| `--no-install` | Do not install dependencies              |                             |
| `--no-git`     | Do not create a git repository           |                             |
| `-y`, `--yes`  | Use defaults, no prompts                 |                             |
| `-h`, `-v`     | Help, version                            |                             |

```sh
npm create quickben@latest my-app -- --db postgres --example blog --yes
```

With npm, put `--` before the options.

The directory must be new or empty. The git repository is skipped inside an existing work tree.

## What you get

| File                                 | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `quickben.config.ts`                 | Collections, database and auth.                          |
| `lib/db.ts`                          | Database adapter for the chosen `--db`.                  |
| `lib/auth.ts`                        | `devAuth()` in development, anonymous in production.     |
| `app/api/[...quickben]/route.ts`     | REST route handlers.                                     |
| `app/admin/[[...segments]]/page.tsx` | Admin page with its server function.                     |
| `app/page.tsx`                       | Home page that reads with the local API.                 |
| `next.config.ts`                     | `serverExternalPackages` for the adapter and drivers.    |
| `.env.example`, `.env.local`         | Dev user and database settings. `.env.local` is ignored. |

| `--db`     | Adapter                                   | Driver                 |
| ---------- | ----------------------------------------- | ---------------------- |
| `pglite`   | `@quickben/db-drizzle`, data in `.pglite` | `@electric-sql/pglite` |
| `postgres` | `@quickben/db-drizzle`, `DATABASE_URL`    | `pg`                   |
| `sqlite`   | `@quickben/db-drizzle`, `DATABASE_URL`    | `@libsql/client`       |
| `memory`   | `@quickben/db-memory`                     |                        |

The `@quickben/*` versions in the app are the versions released with this CLI.

## Development

Templates are in `templates/`: `base`, then `db/<db>`, then `example/<example>`. Later layers replace files, `package.json` files are merged and `.env.example` files are concatenated. A leading `_` in a file name becomes `.`. `{{name}}` and the other placeholders in `src/template.ts` are replaced.

Templates use `workspace:^` for `@quickben/*`. `pnpm build` copies them to `dist/templates` with those ranges replaced by the current package versions.

```sh
pnpm --filter create-quickben test          # unit tests
pnpm turbo run build --filter=./packages/*  # then:
pnpm --filter create-quickben test:e2e      # scaffold pglite + blank, install from tarballs, next build, next start
```
