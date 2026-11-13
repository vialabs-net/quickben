import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { http } from "./http";
import { openaiCompatible } from "./openai";
import { vertex } from "./vertex";

import type { AnyProvider } from "../provider";

export { ANTHROPIC_URL, anthropic } from "./anthropic";
export { GEMINI_URL, gemini } from "./gemini";
export { parseServiceAccount } from "./google-auth";
export { authHeaders, http, httpFields } from "./http";
export { OPENAI_URL, openaiCompatible } from "./openai";
export { llmFields, llmModelSchema, llmModelsSchema, pickModel } from "./shared";
export { VERTEX_TEST_MODEL, vertex, vertexFields, vertexRoot } from "./vertex";

export type { ServiceAccount } from "./google-auth";
export type { LlmModel } from "./shared";

/** The providers `connections()` registers unless `builtins: false`. */
export const builtinProviders: readonly AnyProvider[] = [
  anthropic,
  openaiCompatible,
  gemini,
  vertex,
  http,
];
