# Contributing

## Setup

Requirements: Node.js 24 (see `.nvmrc`; 22.18+ works) and pnpm 12.

```sh
corepack enable          # installs the pnpm version pinned in package.json
pnpm install
pnpm turbo run lint typecheck test build
```

## Commands

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `pnpm build`         | Build every package to `dist/` with tsdown.        |
| `pnpm lint`          | ESLint (typescript-eslint, sonarjs, import order). |
| `pnpm typecheck`     | `tsc` in every package, including type tests.      |
| `pnpm test`          | Vitest in every package.                           |
| `pnpm test:coverage` | Tests with coverage. Fails under 85 % lines.       |
| `pnpm format`        | Prettier.                                          |
| `pnpm changeset`     | Describe a change for the changelog.               |

Turborepo caches results. Run one package with `pnpm --filter @quickben/core test`.

## Pull requests

- Branch from `trunk`. Keep pull requests small.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): add json field`, `fix(db-memory): …`, `docs: …`, `chore: …`.
- Add a changeset (`pnpm changeset`) when a published package changes.
- CI must pass: lint, typecheck, tests with coverage, build and the SonarCloud quality gate.

## Database adapters

An adapter implements `DatabaseAdapter` from `@quickben/core` and must pass the shared suite:

```ts
// packages/db-foo/test/contract.test.ts
import { runAdapterContractTests } from "@quickben/adapter-tests";
import { fooAdapter } from "../src";

runAdapterContractTests(() => fooAdapter());
```

## Code style

- TypeScript strict. No `any` in public types.
- Short JSDoc on every public export. Plain English.
- No circular imports (`import-x/no-cycle`).
