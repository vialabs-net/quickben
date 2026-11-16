import { connectionsAdmin } from "@quickben/plugin-connections/admin";
import { tenancyAdmin } from "@quickben/plugin-tenancy/admin";

import { connectionsEnabled } from "@/lib/connections";
import { tenancyEnabled } from "@/lib/tenancy";
import { organizationSections } from "@/lib/tenancy-sections";
import config from "@/quickben.config";

import type { AdminOptions } from "@quickben/admin";

const basePath = "/embedded";

/** Options shared by the embedded admin page and the host navigation. */
export const embeddedOptions = {
  basePath,
  extensions: [
    // With QUICKBEN_TENANCY=1 the embedded admin has the tenancy pages, settings sections included.
    ...(tenancyEnabled ? [tenancyAdmin(config, { basePath, sections: organizationSections })] : []),
    // With QUICKBEN_CONNECTIONS=1 it has the connections and credentials pages.
    ...(connectionsEnabled ? [connectionsAdmin(config, { basePath })] : []),
  ],
} satisfies AdminOptions;
