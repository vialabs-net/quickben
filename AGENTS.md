# Notes for coding agents

## Web UI work: use Modern Web Guidance

Before writing or changing HTML, CSS or client-side JS in `apps/docs`, `apps/playground`,
`packages/admin` or `packages/create-quickben/templates`, look up current platform guidance with
[Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) (Chrome, Edge, Firefox and
MDN). Prefer native platform features (dialog, popover, container queries, `text-wrap`, view
transitions) over extra JavaScript or dependencies.

| Agent                              | Setup                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                        | Nothing to do. `.claude/settings.json` adds the `googlechrome` marketplace and enables the `modern-web-guidance` plugin; accept the trust prompt on first run. |
| Others (Codex, Copilot, Gemini, …) | `npx modern-web-guidance@latest install`, or call the CLI directly as below.                                                                                   |

```sh
npx -y modern-web-guidance@latest search "light dismiss dialog"   # 2–5 words, one capability
npx -y modern-web-guidance@latest retrieve "<id>[,<id>]"
npx -y modern-web-guidance@latest legacy-scan apps/docs/app        # whole-codebase audit only
```

Not for backend, database, CI or tooling work.

## Other skills in this repo

| Skill                              | Use                                           |
| ---------------------------------- | --------------------------------------------- |
| `.agents/skills/dependabot-review` | Dependabot alerts and PRs (after #39 merges). |
