import { geminiLogo } from "../logos";
import { defineProvider } from "../provider";

import { fromStatus, joinUrl, llmFields, requireSecret, testModel } from "./shared";

/** Default API root of the Gemini API (Google AI Studio). */
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google Gemini with an AI Studio API key. Test: `countTokens` on the requested or default
 * model (free); with no model configured, `GET /models`. The key goes in the `x-goog-api-key`
 * header, never in the URL.
 */
export const gemini = defineProvider({
  type: "google",
  label: "Google Gemini",
  category: "AI models",
  description: "Gemini models with a Google AI Studio API key.",
  logo: geminiLogo,
  capabilities: ["llm", "vision"],
  baseUrl: { placeholder: GEMINI_URL },
  credential: { required: true, kinds: ["api_key"] },
  fields: llmFields,
  test: async ({ baseUrl, metadata, credential, model, fetch, signal }) => {
    const key = requireSecret("Gemini", credential);
    if ("result" in key) return key.result;
    const root = baseUrl ?? GEMINI_URL;
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      "x-goog-api-key": key.secret,
    };
    const modelId = testModel(metadata, model, undefined);
    if (modelId === undefined) {
      return fromStatus(
        "Gemini",
        await fetch(joinUrl(root, "/models?pageSize=1"), { headers, signal }),
      );
    }
    const response = await fetch(
      joinUrl(root, `/models/${encodeURIComponent(modelId)}:countTokens`),
      {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "OK" }] }] }),
      },
    );
    return fromStatus("Gemini", response, modelId);
  },
});
