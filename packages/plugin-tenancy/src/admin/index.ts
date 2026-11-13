import { normalizeBasePath } from "./base-path";
import { createMembersPage } from "./members";
import { createOrganizationPage } from "./organization";
import { registerTenancyAdmin } from "./registry";
import { createSwitcher } from "./switcher";

import type { AdminExtension } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

/** Options of {@link tenancyAdmin}. */
export interface TenancyAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the tenancy pages. Default `Organization`. */
  group?: string;
}

/**
 * Admin UI for the tenancy plugin: an organization switcher at the top of the sidebar, a
 * Members page and an Organization settings page.
 *
 * ```tsx
 * export default createAdminPage(config, { extensions: [tenancyAdmin(config)] });
 * ```
 *
 * Every change goes through the tenancy helpers, so access rules and guard rails apply.
 */
export function tenancyAdmin(
  config: QuickbenConfig,
  options: TenancyAdminOptions = {},
): AdminExtension {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerTenancyAdmin({ config, basePath });
  const group = options.group ?? "Organization";
  return {
    sidebar: [createSwitcher(config, key, basePath)],
    pages: [
      { path: "members", label: "Members", group, component: createMembersPage(config, key) },
      {
        path: "organization",
        label: "Organization settings",
        group,
        component: createOrganizationPage(config, key),
      },
    ],
  };
}
