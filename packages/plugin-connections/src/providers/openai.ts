import { apiLogo } from "../logos";
import { defineProvider } from "../provider";

import { fromStatus, joinUrl, jsonHeaders, llmFields, testModel } from "./shared";

/** Default API root of OpenAI. */
export const OPENAI_URL = "https://api.openai.com/v1";

/**
 * OpenAI or any gateway with its Chat Completions API (llmgateway, OpenRouter, DeepSeek, a local
 * server). Test: a 1-token chat completion to the requested or default model; with no model
 * configured, `GET /models`. Some gateways serve `/models` without a key, so configure a model
 * to test the key itself.
 */
export const openaiCompatible = defineProvider({
  type: "openai_compatible",
  label: "OpenAI or compatible",
  category: "AI models",
  description: "OpenAI or any gateway with its API (llmgateway, OpenRouter, DeepSeek, …).",
  logo: apiLogo,
  capabilities: ["llm", "vision"],
  baseUrl: { placeholder: OPENAI_URL },
  // Local servers often need no key.
  credential: { required: false, kinds: ["api_key"] },
  fields: llmFields,
  test: async ({ baseUrl, metadata, credential, model, fetch, signal }) => {
    const root = baseUrl ?? OPENAI_URL;
    const headers: Record<string, string> = { ...jsonHeaders };
    if (credential) headers.authorization = `Bearer ${credential.secret}`;
    const modelId = testModel(metadata, model, undefined);
    if (modelId === undefined) {
      return fromStatus("The provider", await fetch(joinUrl(root, "/models"), { headers, signal }));
    }
    const response = await fetch(joinUrl(root, "/chat/completions"), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    });
    return fromStatus("The provider", response, modelId);
  },
});
