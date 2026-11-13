import { createAdminPage, handleAdminRequest } from "@quickben/admin";
import { connectionsAdmin } from "@quickben/plugin-connections/admin";
import { docReaderAdmin } from "@quickben/plugin-doc-reader/admin";
import { templatesAdmin } from "@quickben/plugin-templates/admin";
import { tenancyAdmin } from "@quickben/plugin-tenancy/admin";

import { betterAuthEnabled } from "@/lib/better-auth";
import { connectionsEnabled } from "@/lib/connections";
import { docReaderEnabled } from "@/lib/doc-reader";
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
    ...(connectionsEnabled ? [connectionsAdmin(config)] : []),
    ...(templatesEnabled ? [templatesAdmin(config)] : []),
    ...(docReaderEnabled ? [docReaderAdmin(config)] : []),
  ],
  signInHref: betterAuthEnabled ? "/sign-in" : undefined,
});
