import { createRouteHandlers } from "@quickben/next";

import config from "@/quickben.config";

export const { GET, POST, PATCH, DELETE } = createRouteHandlers(config);
