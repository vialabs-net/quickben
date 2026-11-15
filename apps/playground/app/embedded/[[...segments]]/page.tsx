import { createAdminPage, handleAdminRequest } from "@quickben/admin";

import config from "@/quickben.config";

import { embeddedOptions } from "../options";

import type { AdminRequest } from "@quickben/admin";

async function serverFunction(request: AdminRequest) {
  "use server";
  return handleAdminRequest(config, request);
}

// Only the page content: the host layout in ../layout.tsx brings the header and navigation.
export default createAdminPage(config, { ...embeddedOptions, chrome: "none", serverFunction });
