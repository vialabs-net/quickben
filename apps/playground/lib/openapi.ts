import type { OpenApiOptions } from "@quickben/openapi";

/**
 * Options of the playground's OpenAPI document. `quickben-openapi generate` reads them from the
 * `openapi` export of quickben.config.ts; the route handler serves the same document at
 * `GET /api/openapi.json`.
 */
export const openapi = {
  info: {
    title: "Quickben Playground API",
    version: "1.0.0",
    description: "Custom endpoints and the CRUD routes of posts, authors and tags.",
  },
} satisfies OpenApiOptions;
