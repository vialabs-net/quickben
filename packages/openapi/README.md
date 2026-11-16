# @quickben/openapi

OpenAPI 3.1 documents for [Quickben](https://quickben.vialabs.net) apps, and a CLI that checks API contracts in CI.

```ts
import { generateOpenApi, stringifyOpenApi } from "@quickben/openapi";
import config from "./quickben.config";

const doc = generateOpenApi(config, { info: { title: "Shop API", version: "1.0.0" } });
await writeFile("openapi.json", stringifyOpenApi(doc));
```

| Export                                  | What it does                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `generateOpenApi(config, options)`      | OpenAPI 3.1 document of the custom endpoints and the collections opted into documentation. |
| `stringifyOpenApi(doc)`                 | Two-space JSON with a final newline, ready to commit.                                      |
| `diffOpenApi(base, head)`               | Changes between two documents, each breaking or not.                                       |
| `formatDiff(diff)`                      | The diff as text.                                                                          |
| `createOpenApiHandler(config, options)` | Serves `GET <basePath>/openapi.json`. `@quickben/next` uses it.                            |

## What is documented

| Source                                          | In the document                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `defineEndpoint` schemas                        | Path and query parameters, JSON body, responses per status (`z.toJSONSchema`).           |
| Zod schemas with `.meta({ id: "Tag" })`         | `components/schemas/Tag`. When the request form differs (defaults), also `TagInput`.     |
| `summary`, `description`, `tags`, `operationId` | Same keys. Default `operationId`: method and path, e.g. `postV1PostsByIdPublish`.        |
| `deprecated`, `sunset`, `version`               | `deprecated: true`, `x-deprecated-at`, `x-sunset`, `x-quickben-version`.                 |
| `access`                                        | `true`: credentials optional. Otherwise `401` and `403` responses.                       |
| Errors                                          | `components/responses` with the `Error` schema: `{ error: { code, message, details } }`. |
| Collections with `api: { openapi: true }`       | `GET/POST /slug`, `GET/PATCH/DELETE /slug/{id}`, file downloads. Schemas from fields.    |
| `auth.securitySchemes`                          | `components/securitySchemes` and the top-level `security`.                               |

Collection list routes document `where` (JSON), `sort`, `limit`, `page`, `cursor`, `select` and `depth`. Document schemas require only `id`: `select` can omit every other field, including timestamps.

## Options

| Option            | Default                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `info`            | `{ title: <admin title>, version: "0.0.0" }`                                                                               |
| `servers`         | `[{ url: basePath }]`                                                                                                      |
| `basePath`        | `/api`                                                                                                                     |
| `include`         | `{ endpoints: true, collections: <marked> }`. `collections` takes slugs or `false`; `endpoints` takes `false` or a filter. |
| `securitySchemes` | The auth adapter's `securitySchemes`.                                                                                      |
| `security`        | Any one of the schemes.                                                                                                    |
| `maxLimit`        | `100`                                                                                                                      |

Output is deterministic: keys are sorted, field order is kept.

## CLI

```sh
quickben-openapi generate --config quickben.config.ts --out openapi.json
quickben-openapi generate --config quickben.config.ts --out openapi.json --check
quickben-openapi diff base.json head.json [--json]
```

| Command            | Exit codes                                               |
| ------------------ | -------------------------------------------------------- |
| `generate`         | `0` written. With `--check`: `1` when the file is stale. |
| `diff`             | `0` no breaking change, `1` breaking changes.            |
| Bad usage or input | `2`                                                      |

File paths must be inside the working directory. The config module's default export is the config. An `openapi` export holds the generator options; `--title`, `--api-version`, `--server` and `--base-path` override them. TypeScript configs load with `tsx` when the app has it installed, else with Node's type stripping.

## Breaking changes

| Breaking                                                         | Not breaking                     |
| ---------------------------------------------------------------- | -------------------------------- |
| Removed path, operation or version                               | Added path, operation or version |
| New required parameter, body or request field                    | New optional parameter or field  |
| Removed or retyped response field, field that may now be missing | New response field               |
| Narrowed request enum, widened response enum                     | Widened request enum             |
| Removed status code, new success status code                     | New error status code            |

Docs: [OpenAPI](https://quickben.vialabs.net/docs/concepts/openapi).

Allowed (reported, exit `0`): breaking changes of a new version of a route compared with the previous version, and removing a deprecated operation after its `x-sunset` date.
