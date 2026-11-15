import { tenancyAdmin } from "@quickben/plugin-tenancy/admin";

import { tenancyEnabled } from "@/lib/tenancy";
import { organizationSections } from "@/lib/tenancy-sections";
import config from "@/quickben.config";

import type { AdminOptions } from "@quickben/admin";

const basePath = "/embedded";

/** Options shared by the embedded admin page and the host navigation. */
export const embeddedOptions = {
  basePath,
  // With QUICKBEN_TENANCY=1 the embedded admin has the tenancy pages, settings sections included.
  extensions: tenancyEnabled
    ? [tenancyAdmin(config, { basePath, sections: organizationSections })]
    : [],
} satisfies AdminOptions;
