import { z } from "zod";

import { googleCloudLogo } from "../logos";
import { defineProvider } from "../provider";

import { parseServiceAccount, serviceAccountToken } from "./google-auth";
import {
  fromStatus,
  joinUrl,
  jsonHeaders,
  llmModelsSchema,
  statusError,
  testModel,
} from "./shared";

/** The model a Vertex test counts tokens on when the connection lists none. */
export const VERTEX_TEST_MODEL = "gemini-2.5-flash";

/** The Vertex AI API root for a location. `global` has no regional prefix. */
export function vertexRoot(location: string): string {
  return location === "global"
    ? "https://aiplatform.googleapis.com/v1"
    : `https://${location}-aiplatform.googleapis.com/v1`;
}

const optionalText = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().max(200).optional(),
);

/** Metadata of a Vertex AI connection. */
export const vertexFields = z.object({
  project: optionalText.meta({
    title: "Project",
    description: "Google Cloud project id. Default: the service account's project.",
    placeholder: "my-project",
  }),
  location: z
    .string()
    .trim()
    .regex(/^[\da-z-]{1,40}$/, "A Google Cloud region, e.g. us-central1")
    .default("us-central1")
    .meta({ title: "Location", placeholder: "us-central1" }),
  models: llmModelsSchema.default([]).meta({
    title: "Models",
    description: 'Models callers may use, e.g. [{ "id": "gemini-2.5-flash", "default": true }].',
  }),
});

/**
 * Gemini on Google Cloud Vertex AI. Always needs a credential: a service account key, or an API
 * key (express mode). The plugin never falls back to the server's own Google credentials, so a
 * token of the server can never reach a URL typed in the admin.
 *
 * Test: `countTokens` on the requested, default or {@link VERTEX_TEST_MODEL} model (free).
 */
export const vertex = defineProvider({
  type: "vertex",
  label: "Google Vertex AI",
  category: "AI models",
  description: "Gemini in a Google Cloud project, with a service account or an API key.",
  logo: googleCloudLogo,
  capabilities: ["llm", "vision"],
  baseUrl: { placeholder: "https://us-central1-aiplatform.googleapis.com/v1" },
  credential: { required: true, kinds: ["service_account_json", "api_key"] },
  fields: vertexFields,
  test: async ({ baseUrl, metadata, credential, model, fetch, signal }) => {
    if (!credential) return { ok: false, error: "Vertex AI needs a credential." };
    const modelId = testModel(metadata, model, VERTEX_TEST_MODEL) ?? VERTEX_TEST_MODEL;
    const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "OK" }] }] });
    const modelPath = `/publishers/google/models/${encodeURIComponent(modelId)}:countTokens`;
    if (credential.kind === "api_key") {
      // Express mode: the global endpoint, no project.
      const response = await fetch(joinUrl(baseUrl ?? vertexRoot("global"), modelPath), {
        method: "POST",
        headers: { ...jsonHeaders, "x-goog-api-key": credential.secret },
        body,
        signal,
      });
      return fromStatus("Vertex AI", response, modelId);
    }
    const account = parseServiceAccount(credential.secret);
    if (!account) return { ok: false, error: "The credential is not a service account key." };
    const project = metadata.project ?? account.project_id;
    if (!project) return { ok: false, error: "Set the project of the connection." };
    const token = await serviceAccountToken(account, fetch, signal);
    if ("status" in token) {
      return {
        ok: false,
        error: `Google refused the service account (HTTP ${String(token.status)}).`,
      };
    }
    const root = baseUrl ?? vertexRoot(metadata.location);
    const path = `/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(metadata.location)}${modelPath}`;
    const response = await fetch(joinUrl(root, path), {
      method: "POST",
      headers: { ...jsonHeaders, authorization: `Bearer ${token.token}` },
      body,
      signal,
    });
    return response.ok
      ? { ok: true, model: modelId }
      : { ok: false, error: statusError("Vertex AI", response.status), model: modelId };
  },
});
