# @quickben/tsconfig

Shared TypeScript presets. Private to this monorepo.

| Preset         | Use for                                     |
| -------------- | ------------------------------------------- |
| `base.json`    | Strict ESM settings shared by every preset. |
| `library.json` | Packages built with tsdown.                 |
| `nextjs.json`  | Next.js App Router apps.                    |

```json
{ "extends": "@quickben/tsconfig/library.json" }
```

All presets use `moduleResolution: "bundler"`. Packages are bundled by tsdown and apps by
Next.js, so source files import without `.js` extensions and the published output is still
valid Node ESM.
