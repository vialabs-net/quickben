import { createRouteHandlers } from "@quickben/next";

import config from "@/quickben.config";

export const { GET, POST, PATCH, PUT, DELETE } = createRouteHandlers(config);
