import { createRouteHandlers } from "@quickben/next";

import { openapi } from "@/lib/openapi";
import config from "@/quickben.config";

export const { GET, POST, PATCH, PUT, DELETE } = createRouteHandlers(config, {
  // GET /api/openapi.json, for signed-in users.
  openapi: { ...openapi, serve: true },
});
