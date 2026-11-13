import { z } from "zod";

import { httpLogo } from "../logos";
import { defineProvider } from "../provider";

import { fromStatus, joinUrl } from "./shared";

/** Metadata of a generic HTTP connection. */
export const httpFields = z.object({
  healthPath: z
    .string()
    .trim()
    .regex(/^\/[^\s]*$/, "A path that starts with /")
    .max(500)
    .default("/")
    .meta({
      title: "Test path",
      description: "GET on this path must answer 2xx.",
      placeholder: "/health",
    }),
  authHeader: z
    .string()
    .trim()
    .regex(/^[\w-]{1,100}$/, "A header name")
    .default("Authorization")
    .meta({ title: "API key header", placeholder: "Authorization" }),
  authScheme: z.string().trim().max(40).default("Bearer").meta({
    title: "API key scheme",
    description: "Text before the key, e.g. Bearer. Empty sends the key alone.",
  }),
});

/** Request headers that carry a credential, by kind. */
export function authHeaders(
  metadata: z.output<typeof httpFields>,
  credential: { kind: string; secret: string } | null,
): Record<string, string> {
  if (!credential) return {};
  if (credential.kind === "basic") {
    return { authorization: `Basic ${Buffer.from(credential.secret).toString("base64")}` };
  }
  const scheme = metadata.authScheme.trim();
  return {
    [metadata.authHeader]: scheme === "" ? credential.secret : `${scheme} ${credential.secret}`,
  };
}

/**
 * Any HTTP API with an API key (sent in a header) or a username and password (HTTP Basic).
 * Test: `GET <base URL><test path>` must answer 2xx.
 */
export const http = defineProvider({
  type: "http",
  label: "HTTP API",
  category: "Other",
  description: "Any HTTP API with an API key or a username and password.",
  logo: httpLogo,
  capabilities: [],
  baseUrl: { required: true, placeholder: "https://api.example.com" },
  credential: { required: false, kinds: ["api_key", "basic"] },
  fields: httpFields,
  test: async ({ baseUrl, metadata, credential, fetch, signal }) => {
    if (!baseUrl) return { ok: false, error: "Set the base URL of the connection." };
    const response = await fetch(
      joinUrl(baseUrl, metadata.healthPath === "/" ? "" : metadata.healthPath),
      {
        headers: { accept: "application/json", ...authHeaders(metadata, credential) },
        signal,
      },
    );
    return fromStatus("The API", response);
  },
});
