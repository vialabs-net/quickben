import { normalizeBasePath } from "./base-path";
import { createMembersPage } from "./members";
import { tenancyMessages } from "./messages";
import { assertSections, createOrganizationPage } from "./organization";
import { registerTenancyAdmin } from "./registry";
import { createSwitcher } from "./switcher";

import type { OrganizationSection } from "./organization";
import type { OrganizationSwitcherProps } from "./switcher";
import type { AdminExtension, AdminI18n, AdminText } from "@quickben/admin";
import type { MessageKey } from "@quickben/admin/i18n";
import type { QuickbenConfig } from "@quickben/core";
import type { ReactNode } from "react";

export { tenancyMessages } from "./messages";
export type { OrganizationSection, OrganizationSectionProps } from "./organization";
export type { OrganizationSwitcherProps } from "./switcher";

/** Options of {@link tenancyAdmin}. */
export interface TenancyAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the tenancy pages. Default `Organization` (translated). */
  group?: AdminText;
  /**
   * Extra tabs of the Organization settings page, from the host or other plugins. Each one is
   * a server component at `<basePath>/organization/<key>` and can use its own server actions.
   */
  sections?: readonly OrganizationSection[];
}

/** Options of {@link createOrganizationSwitcher}. */
export interface OrganizationSwitcherOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
}

/** Admin text from the tenancy catalog. */
function text(key: MessageKey<typeof tenancyMessages>): AdminText {
  return (i18n: AdminI18n) => i18n.scope(tenancyMessages).t(key);
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
  const group = options.group ?? text("nav.group");
  const sections = options.sections ?? [];
  assertSections(sections);
  return {
    sidebar: [createSwitcher(config, key, basePath)],
    catalogs: [tenancyMessages],
    pages: [
      {
        path: "members",
        label: text("nav.members"),
        group,
        component: createMembersPage(config, key),
      },
      {
        path: "organization",
        label: text("nav.organization"),
        group,
        component: createOrganizationPage(config, key, sections),
      },
    ],
  };
}

/**
 * The organization switcher as a server component, for a host layout (embedded mode,
 * `chrome: "none"`). Use the same `basePath` as `createAdminPage`.
 *
 * ```tsx
 * const OrganizationSwitcher = createOrganizationSwitcher(config);
 * // in a layout: <OrganizationSwitcher />
 * ```
 */
export function createOrganizationSwitcher(
  config: QuickbenConfig,
  options: OrganizationSwitcherOptions = {},
): (props: OrganizationSwitcherProps) => Promise<ReactNode> {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerTenancyAdmin({ config, basePath });
  return createSwitcher(config, key, basePath);
}
