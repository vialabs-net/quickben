import { ref } from "./schemas";

import type { SchemaRegistry } from "./schemas";
import type { OpenApiResponse } from "./types";

/** Error responses shared by operations, by status. */
export const errorResponses = {
  400: { name: "ValidationError", description: "Invalid input (`VALIDATION`)." },
  401: { name: "Unauthorized", description: "No user (`UNAUTHORIZED`)." },
  403: { name: "Forbidden", description: "The user may not do this (`FORBIDDEN`)." },
  404: { name: "NotFound", description: "No such document or route (`NOT_FOUND`)." },
  409: { name: "Conflict", description: "A unique value is taken (`CONFLICT`)." },
  413: { name: "PayloadTooLarge", description: "The body is too large (`PAYLOAD_TOO_LARGE`)." },
  415: {
    name: "UnsupportedMediaType",
    description: "Wrong content type (`UNSUPPORTED_MEDIA_TYPE`).",
  },
  500: { name: "InternalError", description: "Unexpected server error (`INTERNAL`)." },
} as const;

/** Status of a shared error response. */
export type ErrorStatus = keyof typeof errorResponses;

/** Add the `Error` schema (the body of every error response). */
export function addErrorSchema(registry: SchemaRegistry): void {
  registry.add("Error", {
    type: "object",
    description: "Body of every error response.",
    properties: {
      error: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "VALIDATION, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, METHOD_NOT_ALLOWED, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE or INTERNAL.",
          },
          message: { type: "string" },
          details: {
            description:
              "`{ issues }` for VALIDATION, `{ field }` for CONFLICT, `{ fields }` for FORBIDDEN from field rules, else null.",
            anyOf: [{ type: "object" }, { type: "null" }],
          },
        },
        required: ["code", "message", "details"],
      },
    },
    required: ["error"],
  });
}

/** `components/responses` for the statuses used. */
export function errorComponents(used: ReadonlySet<ErrorStatus>): Record<string, OpenApiResponse> {
  const components: Record<string, OpenApiResponse> = {};
  for (const status of used) {
    const { name, description } = errorResponses[status];
    components[name] = { description, content: { "application/json": { schema: ref("Error") } } };
  }
  return components;
}

/** Add `$ref`s to the shared error responses, keeping statuses already set. */
export function addErrors(
  responses: Record<string, OpenApiResponse>,
  statuses: readonly ErrorStatus[],
  used: Set<ErrorStatus>,
): void {
  for (const status of statuses) {
    if (Object.hasOwn(responses, String(status))) continue;
    used.add(status);
    responses[String(status)] = { $ref: `#/components/responses/${errorResponses[status].name}` };
  }
}
