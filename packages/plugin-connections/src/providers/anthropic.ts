import { anthropicLogo } from "../logos";
import { defineProvider } from "../provider";

import { fromStatus, joinUrl, llmFields, requireSecret, testModel } from "./shared";

/** Default API root of Anthropic. */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1";

/**
 * Anthropic (Claude). Test: a 1-token message to the requested or default model; with no model
 * configured, `GET /models`.
 */
export const anthropic = defineProvider({
  type: "anthropic",
  label: "Anthropic",
  category: "AI models",
  description: "Claude models.",
  logo: anthropicLogo,
  capabilities: ["llm", "vision"],
  baseUrl: { placeholder: ANTHROPIC_URL },
  credential: { required: true, kinds: ["api_key"] },
  fields: llmFields,
  test: async ({ baseUrl, metadata, credential, model, fetch, signal }) => {
    const key = requireSecret("Anthropic", credential);
    if ("result" in key) return key.result;
    const root = baseUrl ?? ANTHROPIC_URL;
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": key.secret,
      "anthropic-version": "2023-06-01",
    };
    const modelId = testModel(metadata, model, undefined);
    if (modelId === undefined) {
      return fromStatus(
        "Anthropic",
        await fetch(joinUrl(root, "/models?limit=1"), { headers, signal }),
      );
    }
    const response = await fetch(joinUrl(root, "/messages"), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    });
    return fromStatus("Anthropic", response, modelId);
  },
});
