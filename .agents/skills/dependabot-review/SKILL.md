---
name: dependabot-review
description: >
  Review Dependabot security alerts and Dependabot PRs for Quickben, plan the fix and apply it.
  Use when the user asks to check security vulnerabilities, review a Dependabot alert or PR,
  fix a CVE, audit dependencies, or gives a Dependabot alert URL. Also use for "check security",
  "fix vulnerability", "dependabot", "CVE" or "security alert".
---

# Dependabot review

Repository: `vialabs-net/quickben`. Package manager: pnpm workspaces (`pnpm-workspace.yaml`, one
`pnpm-lock.yaml` at the root). Builds and tests run through Turborepo.

## What is configured

| Item                                                   | Where                                |
| ------------------------------------------------------ | ------------------------------------ |
| Version updates (npm, GitHub Actions), weekly, grouped | `.github/dependabot.yml`             |
| Pinned upper bounds (`typescript`, `@types/node`)      | `ignore` in `.github/dependabot.yml` |
| Dependabot alerts and security update PRs              | Repository settings → Code security  |
| Secret scanning                                        | Repository settings → Code security  |
| Forced versions for transitive deps                    | `overrides` in `pnpm-workspace.yaml` |

## Input

One of:

- an alert URL, e.g. `https://github.com/vialabs-net/quickben/security/dependabot/3`, or its number;
- `all`, `critical`, `high` to list open alerts;
- a package name;
- a Dependabot PR number.

## 1. Fetch

One alert:

```bash
gh api repos/vialabs-net/quickben/dependabot/alerts/<N> --jq '{
  number, state, html_url,
  package: .dependency.package.name,
  manifest: .dependency.manifest_path,
  relationship: .dependency.relationship,
  scope: .dependency.scope,
  vulnerable_range: .security_vulnerability.vulnerable_version_range,
  patched: .security_vulnerability.first_patched_version.identifier,
  severity: .security_advisory.severity,
  cvss: .security_advisory.cvss.score,
  summary: .security_advisory.summary,
  cve: .security_advisory.cve_id,
  ghsa: .security_advisory.ghsa_id,
  references: [.security_advisory.references[].url]
}'
```

Open alerts:

```bash
gh api 'repos/vialabs-net/quickben/dependabot/alerts?state=open&per_page=100' --jq '[.[] | {
  number, severity: .security_advisory.severity,
  package: .dependency.package.name,
  scope: .dependency.scope,
  relationship: .dependency.relationship,
  patched: .security_vulnerability.first_patched_version.identifier,
  summary: .security_advisory.summary
}]'
```

Open Dependabot PRs:

```bash
gh pr list -R vialabs-net/quickben --author app/dependabot --json number,title,headRefName
```

## 2. Assess

| Factor         | Question                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity       | CVSS score and GitHub severity.                                                                                                                                              |
| Exploitability | Network access, user interaction, privileges needed?                                                                                                                         |
| Exposure       | `runtime` or `development` scope; `direct` or `transitive`.                                                                                                                  |
| Shipped?       | Is the package a `dependency` or `peerDependency` of a published `@quickben/*` package? Then users get it. Dev tooling, `apps/docs` and `apps/playground` are not published. |
| Fix            | Is there a patched version?                                                                                                                                                  |

Summary table:

```
| # | Severity | Package | Patched | Scope | Relationship | Shipped | Fix |
```

## 3. Resolve

| Case                              | Action                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct dep, patch exists          | `pnpm --filter <pkg> up <dep>@<patched>`, or `pnpm -r up <dep>@<patched>` if several packages use it.                                                  |
| Transitive dep, parent has a fix  | Update the parent: `pnpm why <dep>` shows who pulls it in.                                                                                             |
| Transitive dep, parent has no fix | Add `"<parent>><dep>": <patched>` (or `<dep>: <patched>`) under `overrides` in `pnpm-workspace.yaml`, with a comment saying why and when to remove it. |
| No patch, code path not reachable | Dismiss with reason `not_used` and an explanation.                                                                                                     |
| No patch, reachable               | Mitigate in code or replace the package. Open an issue.                                                                                                |
| Dev-only, low risk                | Update, or dismiss as `tolerable_risk` with a comment.                                                                                                 |
| Major bump PR from Dependabot     | Read the changelog; check peer ranges (`typescript-eslint`, `eslint-plugin-sonarjs`, Next.js, React). Fix breakages in the same PR.                    |

Dismiss:

```bash
gh api -X PATCH repos/vialabs-net/quickben/dependabot/alerts/<N> \
  -f state=dismissed -f dismissed_reason=not_used -f dismissed_comment="<why>"
```

Reasons: `fix_started`, `inaccurate`, `no_bandwidth`, `not_used`, `tolerable_risk`.

## 4. Verify

```bash
pnpm install
pnpm why <dep>              # the vulnerable version is gone
pnpm typecheck && pnpm lint && pnpm test
pnpm build
```

If a published package's `dependencies` changed, add a changeset (`pnpm changeset`, patch level).
After the merge, Dependabot closes the alert on its own.

## 5. Report

```
## Alert #<N>: <package> (<severity>)

CVE <cve>, GHSA <ghsa>, CVSS <score>
<package>@<range> → <patched>, <scope>/<relationship>, shipped: <yes|no>

Summary: <one paragraph>
Resolution: <what changed and why>
Verification: <commands and results>
Remaining risk: <or "none">
```
