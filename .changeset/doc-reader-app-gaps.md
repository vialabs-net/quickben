---
"@quickben/plugin-doc-reader": minor
"@quickben/plugin-connections": minor
---

Doc reader: what the first app on it needed.

- Field keys may be camelCase words joined by `.` (`vehicle.make`). `nestValues` and `flattenValues` convert between dotted keys and nested JSON; `importSamples` reads nested expected values by dotted key.
- `vision-llm` options: `includeText` and `textBoxes` (send the PDF's text layer with the images), `maxOutputTokens`, `temperature` (`null` sends none), `reasoning`, `providerOptions` (e.g. `{ anthropic: { effort: "low" } }`), `output` (`structured` or `json`), `groupSize` and `repair`.
- Connections by name: steps and variants take `connection` instead of `connectionId`. New option `resolveConnectionId`, provided by `connectionModels()`. Connections: `findConnectionIdByName`.
- Variants take `options` with the `vision-llm` options above.
- Extractor context has `qb` and `user`; `runPipeline` takes them.
- Large types: fields are read in groups (default 24 with structured outputs), in parallel, with cost added up. A group whose schema the provider refuses as too large is split, then asked as plain JSON.
- Repairs: fields missing, invalid, or required and empty are asked again once by default (`repair`). Attempts record `repairs`; run metrics add `repaired`, `repairs` and `stepErrors`. A structured reply that fails the schema keeps its valid fields.
- Provider errors show their HTTP status and fixed diagnostics for recognized schema-size or token-limit errors. Raw messages are never persisted because they may echo credentials.
- Types in `types` that changed in the code become a draft (never touching the published version), logged as `type-changed-in-code` and shown in the admin.

**Migration**

- Types with more than 24 fields on a model with structured outputs now make one call per group of 24 fields. Set `groupSize` to the field count to keep one call, or `output: "json"`.
- `repair` defaults to 1: a reading with missing or invalid fields, or required fields left empty, makes one more call and costs more. Set `repair: 0` to keep one call.
- A provider error that is not a timeout, 429 or 5xx is no longer `transient`: test runs do not retry it and score the sample as read. The error text now starts with `the model provider rejected the request` and adds the status and message.
- A changed type in `types` now creates a draft at start. Before, the change was ignored.
- `visionConfigSchema.connectionId` is optional; a step needs `connectionId` or `connection`.
