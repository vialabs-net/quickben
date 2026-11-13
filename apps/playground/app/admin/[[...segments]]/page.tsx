import { createAdminPage, handleAdminRequest } from "@quickben/admin";
import { templatesAdmin } from "@quickben/plugin-templates/admin";
import { tenancyAdmin } from "@quickben/plugin-tenancy/admin";

import { templatesEnabled } from "@/lib/templates";
import { tenancyEnabled } from "@/lib/tenancy";
import config from "@/quickben.config";

import type { AdminRequest } from "@quickben/admin";

// Defined here, next to the config import, so admin saves keep working right after a
// server restart or on a fresh serverless instance.
async function serverFunction(request: AdminRequest) {
  "use server";
  return handleAdminRequest(config, request);
}

export default createAdminPage(config, {
  serverFunction,
  extensions: [
    ...(tenancyEnabled ? [tenancyAdmin(config)] : []),
    ...(templatesEnabled ? [templatesAdmin(config)] : []),
  ],
});
