# Releasing

Quickben publishes to npm with **Trusted Publishing** (OIDC). GitHub Actions proves its identity to npm, so there
is no npm token in the repository, and npm adds provenance to every version.

## Normal release

| Step | Who | What happens |
| --- | --- | --- |
| 1 | Contributor | Each PR adds a changeset (`pnpm changeset`). |
| 2 | Release workflow | On every push to `trunk` it opens or updates the "chore: version packages" PR. |
| 3 | Maintainer | Merges that PR. |
| 4 | Release workflow | Builds, runs `scripts/publish.mjs` (publishes versions that are not on npm yet) and pushes git tags. |

The workflow only runs when the repository variable `NPM_TRUSTED_PUBLISHING` is `true`.

## One-time setup

1. Settings › Actions › General › Workflow permissions: enable **Allow GitHub Actions to create and approve pull
   requests**.
2. Create the npm organization `quickben` (https://www.npmjs.com/org/create).

## Adding a new package (first publish)

npm can only link a trusted publisher to a package that already exists, so each new package is published once by
hand:

```sh
npm login                      # as a member of the quickben npm org
pnpm changeset version         # sets the real versions (do not commit if the version PR will do it)
pnpm release:local             # builds and publishes the packages missing on npm, without provenance
git checkout -- .              # discard the local version bump if you will merge the version PR instead
```

Then, for each new package, on npmjs.com › package › Settings › **Trusted publishing**:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `vialabs-net` |
| Repository | `quickben` |
| Workflow filename | `release.yml` |
| Environment | (empty) |

Optionally set **Publishing access** to "Require two-factor authentication and disallow tokens" once the trusted
publisher works.

Finally set the repository variable `NPM_TRUSTED_PUBLISHING=true` (Settings › Secrets and variables › Actions ›
Variables) if it is not set yet.
