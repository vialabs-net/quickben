# Changesets

Each pull request that changes a published package adds a changeset:

```sh
pnpm changeset
```

Use `patch` while the packages are 0.x. `minor` and `major` need the label `release:minor` or
`release:major` on the pull request (see [CONTRIBUTING.md](../CONTRIBUTING.md#changesets)).

See [Changesets](https://github.com/changesets/changesets) for details.
