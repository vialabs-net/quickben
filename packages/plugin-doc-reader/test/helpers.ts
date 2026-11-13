import { createQuickben, defineConfig, devAuth } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { MockLanguageModelV4 } from "ai/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { docReader, inProcessRunner, memoryFileStore, parseDocumentType } from "../src";

import type { DocReaderOptions, DocumentTypeInput, ExtractionTemplate, ModelInfo } from "../src";
import type { QuickbenUser, RequestContext } from "@quickben/core";

/** A PDF with the given text lines per page, for tests. */
export async function makePdf(pages: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([600, 400]);
    text.split("\n").forEach((line, index) => {
      page.drawText(line, { x: 20, y: 360 - index * 14, size: 8, font });
    });
  }
  return new Uint8Array(await doc.save());
}

/** A 1x1 PNG. */
export const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.codePointAt(0) ?? 0,
);

export interface MockCall {
  readonly prompt: unknown;
  readonly responseFormat?: { readonly type: string };
}

/** An AI SDK mock model: no network, a fixed answer and token counts. */
export function mockModel(
  answer: string | (() => string) | Error,
  tokens: { input: number; output: number } = { input: 1000, output: 100 },
) {
  const calls: MockCall[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: (options) => {
      calls.push({ prompt: options.prompt, responseFormat: options.responseFormat });
      if (answer instanceof Error) return Promise.reject(answer);
      const text = typeof answer === "function" ? answer() : answer;
      return Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: tokens.input,
            noCache: tokens.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: tokens.output, text: tokens.output, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
  return { model, calls };
}

export const modelInfo = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "vision-test",
  vision: true,
  structuredOutput: true,
  maxPages: 2,
  inputPerMTokUsd: 3,
  outputPerMTokUsd: 15,
  ...overrides,
});

export const invoiceTemplate: ExtractionTemplate = {
  match: ["INVOICE"],
  fields: {
    number: [{ pattern: String.raw`INVOICE (?:NO\.?|#)\s*([A-Z\d-]+)` }],
    issuedOn: [{ pattern: String.raw`DATE:?\s*(\d{2}/\d{2}/\d{4})` }],
    total: [{ pattern: String.raw`TOTAL:?\s*\$?\s*([\d.,]+)` }],
    buyerTaxId: [{ pattern: String.raw`BUYER ID:?\s*([\d.\-K]+)` }],
  },
};

export const invoiceInput: DocumentTypeInput = {
  key: "invoice",
  version: 1,
  label: "Invoice",
  description: "A supplier invoice.",
  fields: [
    { key: "number", label: "Invoice number", type: "text", required: true, transform: "compact" },
    { key: "issuedOn", label: "Issue date", type: "date", required: true },
    { key: "total", label: "Total", type: "number" },
    {
      key: "buyerTaxId",
      label: "Buyer tax id",
      type: "text",
      transform: "compact",
      pattern: String.raw`^\d{6,10}[\dK]$`,
    },
  ],
  params: [
    { key: "issuerTaxIds", label: "Issuer tax ids", type: "string-list", excludes: ["buyerTaxId"] },
  ],
  classification: { text: ["INVOICE"], fileName: ["invoice"] },
  instructions: "The total is the last amount on the page.",
  pipeline: {
    steps: [
      { extractor: "text-layer", config: { template: "invoice" } },
      { extractor: "vision-llm", config: { connectionId: "conn-1" } },
    ],
  },
};

export const invoice = parseDocumentType(invoiceInput);

export const INVOICE_TEXT = [
  "ACME SUPPLIES - INVOICE NO. A-1043",
  "DATE: 05/03/2026",
  "BUYER ID: 12.345.678-K",
  "Widgets x 10 ........................................",
  "TOTAL: $1,234.50",
].join("\n");

/** A complete reply for every field of `invoice`, as strict structured outputs return it. */
export function invoiceReply(values: Partial<Record<string, Partial<Answer>>> = {}): string {
  return JSON.stringify(
    Object.fromEntries(
      invoice.fields.map((field) => [field.key, { ...blank, ...values[field.key] }]),
    ),
  );
}
interface Answer {
  value: string;
  confidence: number;
  page: number;
  evidence: string;
  box: string;
}
const blank: Answer = { value: "", confidence: 0, page: 0, evidence: "", box: "0,0,0,0" };

export const staff: QuickbenUser = {
  id: "staff",
  email: "staff@example.com",
  roles: ["platform-admin"],
};
export const alice: QuickbenUser = { id: "alice", email: "alice@example.com" };
export const bob: QuickbenUser = { id: "bob", email: "bob@example.com" };
export const system: RequestContext = { user: null, overrideAccess: true };
export const as = (user: QuickbenUser | null): RequestContext => ({ user });

/** A config with the doc reader, a memory database, an in-process runner and a mock model. */
export function makeConfig(options: DocReaderOptions & { answer?: string | Error } = {}) {
  const { answer, ...rest } = options;
  const mock = mockModel(answer ?? invoiceReply(), { input: 2000, output: 300 });
  const runner = inProcessRunner();
  const files = memoryFileStore();
  const config = defineConfig({
    db: memoryAdapter(),
    auth: devAuth(),
    collections: [],
    plugins: [
      docReader({
        files,
        runner,
        templates: { invoice: invoiceTemplate },
        types: [invoiceInput],
        resolveModel: (connectionId, modelId) =>
          Promise.resolve({
            connection: { id: connectionId, name: "Test connection" },
            model: modelInfo(modelId ? { id: modelId } : {}),
            languageModel: mock.model,
          }),
        rasterize: (bytes, mime) => Promise.resolve([{ page: 1, bytes, mime }]),
        log: () => undefined,
        ...rest,
      }),
    ],
  });
  return { config, runner, files, mock };
}

export async function setup(options: Parameters<typeof makeConfig>[0] = {}) {
  const made = makeConfig(options);
  const qb = await createQuickben(made.config);
  return { ...made, qb };
}
