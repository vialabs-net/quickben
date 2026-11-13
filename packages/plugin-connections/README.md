# @quickben/plugin-connections

Connections and credentials for [Quickben](https://quickben.vialabs.net): a provider registry, encrypted secrets, connection tests and an admin UI.

```sh
pnpm add @quickben/plugin-connections
```

Full guide: https://quickben.vialabs.net/plugins/connections

## Setup

```ts
import { defineConfig } from "@quickben/core";
import { connections } from "@quickben/plugin-connections";

export default defineConfig({
  db,
  collections: [],
  plugins: [connections({ masterKey: process.env.QUICKBEN_MASTER_KEY })],
});
```

```tsx
import { connectionsAdmin } from "@quickben/plugin-connections/admin";

export default createAdminPage(config, { serverFunction, extensions: [connectionsAdmin(config)] });
```

Generate a key once with `generateMasterKey()` (32 random bytes, base64) and keep it in your secret manager. Without a key, connections and credentials can be listed, but no secret can be stored or used.

## What it adds

| Collection    | Fields                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `credentials` | `name`, `kind` (`api_key`, `service_account_json`, `basic`), `secret`, `last4`, `hasSecret`, `lastTest` |
| `connections` | `name`, `providerType`, `baseUrl`, `metadata`, `credential`, `enabled`, `lastTest`                      |

| Rule                             | Behavior                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Secret                           | Write-only. Encrypted with AES-256-GCM before it is stored. Every read returns `null`: local API, REST, relations, admin. |
| Empty secret on update           | Keeps the stored one. `null` removes it.                                                                                  |
| Secret format                    | `service_account_json`: a Google service account key. `basic`: `username:password`. `api_key`: no spaces.                 |
| `last4`, `hasSecret`, `lastTest` | Set by the plugin. Values from callers are ignored (except with `overrideAccess`).                                        |
| `providerType`                   | A registered provider. Cannot change after create.                                                                        |
| `metadata`                       | Validated by the provider's `fields` schema. Defaults are filled.                                                         |
| `baseUrl`                        | Empty: the provider default. Required when the provider says so.                                                          |
| `credential`                     | Required when the provider says so. Its kind must be one the provider takes.                                              |
| Delete a credential in use       | `ConflictError` (409).                                                                                                    |

## Options

| Option               | Default                                    | Purpose                                                         |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `masterKey`          | none                                       | 32 bytes: hex, base64 or bytes.                                 |
| `previousMasterKeys` | `[]`                                       | Old keys, used only to read. See [key rotation](#key-rotation). |
| `providers`          | `[]`                                       | Your providers. Same `type` as a built-in replaces it.          |
| `builtins`           | `true`                                     | `false`, or a list of built-in types to keep.                   |
| `canManage`          | `user.roles` includes `admin`              | Who may create, change, delete and test.                        |
| `canRead`            | managers and `user.roles` includes `staff` | Who may read (never secrets).                                   |
| `fetch`              | global `fetch`                             | Used by provider tests.                                         |
| `testTimeoutMs`      | `20000`                                    | Test timeout.                                                   |
| `group`              | `Integrations`                             | Admin sidebar group.                                            |

## Built-in providers

| Type                | Label                | Credential                           | Test                                                   |
| ------------------- | -------------------- | ------------------------------------ | ------------------------------------------------------ |
| `anthropic`         | Anthropic            | API key, required                    | 1-token message to the model, else `GET /models`       |
| `openai_compatible` | OpenAI or compatible | API key, optional                    | 1-token chat completion, else `GET /models`            |
| `google`            | Google Gemini        | API key, required                    | `countTokens` on the model, else `GET /models`         |
| `vertex`            | Google Vertex AI     | Service account or API key, required | `countTokens` (service account: OAuth JWT grant first) |
| `http`              | HTTP API             | API key or basic, optional           | `GET <baseUrl><healthPath>` answers 2xx                |

The four LLM providers have the capabilities `llm` and `vision` and a `models` list in `metadata` (`id`, `label`, `vision`, `structuredOutput`, prices per million tokens, `default`). A test uses the requested model, else the default, else the first.

Vertex AI always needs a credential. The plugin never uses the server's own Google credentials, so a server token cannot be sent to a URL typed in the admin.

Test errors are the plugin's own text. Provider messages are never shown, because they can contain secrets.

## Your own provider

```ts
import { defineProvider, redactKeys } from "@quickben/plugin-connections";
import { z } from "zod";

export const identityCheck = defineProvider({
  type: "identity_check",
  label: "Identity check",
  category: "Identity",
  capabilities: ["identity_verification"],
  baseUrl: { required: true, default: "https://id.example.com" },
  credential: { required: true, kinds: ["api_key"] },
  fields: z.object({
    level: z.coerce.number().int().min(0).max(3).meta({ title: "Certificate level" }),
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
  test: async ({ baseUrl, credential, fetch, signal }) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "x-api-key": credential?.secret ?? "" },
      signal,
    });
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  },
  // This API echoes the key in its answers.
  redactResponse: (body) => redactKeys(body, ["organization_api_key"]),
});

connections({ masterKey, providers: [identityCheck] });
```

| Key              | Purpose                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | Stored in `connections.providerType`. Lowercase letters, digits, `_`, `-`.                                                               |
| `category`       | Group in the admin provider picker.                                                                                                      |
| `logo`           | `{ light, dark?, keyline? }`: URLs or `data:` URIs. Without it the admin shows initials.                                                 |
| `capabilities`   | Strings for `findConnectionsByCapability`.                                                                                               |
| `fields`         | Zod schema of `metadata`. The admin form is built from it; `.meta({ title, description, placeholder })` sets labels.                     |
| `test`           | Gets `baseUrl`, parsed `metadata`, the decrypted `credential`, `model`, `fetch` and `signal`. Returns `{ ok, error?, model?, detail? }`. |
| `redactResponse` | Removes secrets from `detail` before it is stored or returned.                                                                           |

The plugin also replaces the credential's secret (and its parts: the password, the private key) wherever it appears in a test result. A test that throws or times out returns a fixed error.

## Server API

Server code only. Without `ctx` the helpers run as trusted code (`overrideAccess`).

| Function                                                            | Returns                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `getConnection(qb, id, ctx?, { allowDisabled? })`                   | Provider, base URL, parsed metadata, decrypted credential          |
| `resolveCredential(qb, id, ctx?)`                                   | `{ id, kind, secret }` in clear text                               |
| `findConnectionsByCapability(qb, capability, ctx?, options?)`       | Enabled connections whose provider has the capability. No secrets. |
| `testConnection(qb, id, ctx?, { model? })`                          | Test outcome. Stored in `lastTest`. Needs `canManage`.             |
| `testCredential(qb, id, ctx?, { providerType?, baseUrl?, model? })` | Test outcome. Default provider: the one of its first connection.   |
| `rotateMasterKey(qb)`                                               | `{ rotated, current }`                                             |
| `listProviders(qb)`                                                 | Registered providers                                               |

`ConnectionError` (400) has a `reason`: `disabled`, `unknown-provider`, `no-credential`, `no-secret`, `wrong-kind`, `not-testable`, `pick-provider`, `not-llm`, `no-model`. `MasterKeyError` (500) means a missing or wrong key.

## AI SDK models

`@quickben/plugin-connections/ai` turns an LLM connection into an [AI SDK](https://ai-sdk.dev) model. Install `ai` and the provider packages you use (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/google-vertex`).

```ts
import { callCost, resolveLanguageModel } from "@quickben/plugin-connections/ai";
import { generateText } from "ai";

const { model, languageModel } = await resolveLanguageModel(qb, connectionId);
const result = await generateText({ model: languageModel, prompt: "Hello" });
const usd = callCost(model, result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0);
```

Pass `{ model: "id" }` to choose a model of the connection, and `factories` for your own provider types.

## Admin

`connectionsAdmin(config)` replaces the list and edit views of both collections.

| Page           | Shows                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| Connections    | Provider logo, credential (`•••• last4`), state of the last test, Test button          |
| New connection | Provider picker grouped by category, then a form built from the provider's schema      |
| Connection     | Form, Test (toast), last test, delete                                                  |
| Credentials    | Kind, masked secret, how many connections use it, last test                            |
| Credential     | Form (secret write-only), Test, connections that use it, delete (refused while in use) |

Test on a credential that no connection uses opens a dialog that asks for the provider and an optional base URL. Users without `canManage` see the pages read-only.

## Key rotation

1. Create a key with `generateMasterKey()`.
2. Deploy with `masterKey: newKey, previousMasterKeys: [oldKey]`. Reads work with both keys.
3. Run `await rotateMasterKey(qb)`. It seals every secret with the new key in one transaction.
4. Deploy without `previousMasterKeys`.

Each stored value names the key that sealed it: `v1:<key id>:<iv>:<tag>:<ciphertext>`.

## Logos

The built-in logos are inline SVGs. Sources and licenses: [LOGOS.md](./LOGOS.md).

## License

Apache-2.0
