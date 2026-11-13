import { docReader, localFileStore } from "@quickben/plugin-doc-reader";
import { MockLanguageModelV4 } from "ai/test";

import type { DocumentTypeInput, ModelInfo } from "@quickben/plugin-doc-reader";

/**
 * Document reading demo switch. Start the playground with `QUICKBEN_DOC_READER=1` to add
 * `@quickben/plugin-doc-reader` with a fake vision model: no API key and no network. The admin
 * gets Document types, Readings and Usage pages under "Documents".
 */
export const docReaderEnabled = process.env.QUICKBEN_DOC_READER === "1";

/** A white 1x1 PNG: what the fake model "sees" for each PDF page. */
const blankPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  ),
  (ch) => ch.codePointAt(0) ?? 0,
);

const demoValues: Record<string, string> = {
  date: "2026-03-05",
  number: "1234.5",
  email: "billing@example.com",
  phone: "+15550100",
};

interface JsonSchema {
  properties?: Record<string, { description?: string }>;
}

/** Answers every field of the asked schema with a plausible value, like a model would. */
function fakeAnswer(schema: JsonSchema | undefined): string {
  const answer: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    const type = /type: (\w+)/u.exec(property.description ?? "")?.[1] ?? "text";
    answer[key] = {
      value: demoValues[type] ?? `DEMO-${key.toUpperCase()}`,
      confidence: 0.92,
      page: 1,
      evidence: `${key} on page 1`,
      box: "100,120,420,160",
    };
  }
  return JSON.stringify(answer);
}

const fakeModel = new MockLanguageModelV4({
  provider: "demo",
  modelId: "demo-vision",
  doGenerate: (options) =>
    Promise.resolve({
      content: [
        {
          type: "text",
          text: fakeAnswer(
            options.responseFormat?.type === "json"
              ? (options.responseFormat.schema as JsonSchema)
              : undefined,
          ),
        },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1500, noCache: 1500, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 200, text: 200, reasoning: undefined },
      },
      warnings: [],
    }),
});

const demoModel: ModelInfo = {
  id: "demo-vision",
  label: "Demo vision (fake)",
  vision: true,
  structuredOutput: true,
  maxPages: 2,
  inputPerMTokUsd: 3,
  outputPerMTokUsd: 15,
};

/** A type shipped with the app: read free from a PDF's text, then by the model. */
const invoice: DocumentTypeInput = {
  key: "invoice",
  version: 1,
  label: "Invoice",
  description: "A supplier invoice.",
  fields: [
    { key: "number", label: "Invoice number", type: "text", required: true, transform: "compact" },
    { key: "issuedOn", label: "Issue date", type: "date", required: true },
    { key: "total", label: "Total", type: "number" },
  ],
  classification: { text: ["INVOICE"], fileName: ["invoice"] },
  pipeline: {
    steps: [
      { extractor: "text-layer", config: { template: "invoice" } },
      { extractor: "vision-llm", config: { connectionId: "demo" } },
    ],
  },
};

/** The doc reader of the playground. Readings run in the web process. */
export const playgroundDocReader = docReader({
  files: localFileStore("./.doc-reader-files"),
  isStaff: (user) => user.roles?.includes("admin") === true,
  types: [invoice],
  templates: {
    invoice: {
      match: ["INVOICE"],
      fields: {
        number: [{ pattern: String.raw`INVOICE (?:NO\.?|#)\s*([A-Z\d-]+)` }],
        issuedOn: [{ pattern: String.raw`DATE:?\s*(\d{2}/\d{2}/\d{4})` }],
        total: [{ pattern: String.raw`TOTAL:?\s*\$?\s*([\d.,]+)` }],
      },
    },
  },
  // In a real app: resolveModel from @quickben/plugin-connections.
  resolveModel: (connectionId) =>
    Promise.resolve({
      connection: { id: connectionId, name: "Demo connection" },
      model: demoModel,
      languageModel: fakeModel,
    }),
  listModels: () =>
    Promise.resolve([
      {
        connectionId: "demo",
        connectionName: "Demo connection",
        models: [{ id: demoModel.id, label: demoModel.label }],
      },
    ]),
  // The default renders PDF pages with @napi-rs/canvas. The fake model needs no pixels.
  rasterize: (bytes, mime, pages) =>
    Promise.resolve(
      mime.startsWith("image/")
        ? [{ page: 1, bytes, mime }]
        : pages.map((page) => ({ page, bytes: blankPng, mime: "image/png" })),
    ),
});
