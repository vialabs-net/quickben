import { normalizeBasePath } from "./base-path";
import { createBrandPage } from "./brand-page";
import { templatesMessages } from "./messages";
import { registerTemplatesAdmin } from "./registry";
import { createTemplatesPage } from "./templates-page";

import type { AdminExtension, AdminI18n, AdminText } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

/** Options of {@link templatesAdmin}. */
export interface TemplatesAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the pages. Default `Documents`, translated. */
  group?: AdminText;
}

/**
 * Admin UI for the templates plugin: a Templates page (list of kinds, and an editor with a
 * variable panel, live preview and publishing at `templates/<kind>`) and a Brand page.
 *
 * ```tsx
 * export default createAdminPage(config, { extensions: [templatesAdmin(config)] });
 * ```
 *
 * Import `@quickben/plugin-templates/styles.css` next to `@quickben/admin/styles.css`. The UI
 * text is in the `templates` message namespace ({@link templatesMessages}, English and Spanish).
 */
export function templatesAdmin(
  config: QuickbenConfig,
  options: TemplatesAdminOptions = {},
): AdminExtension {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerTemplatesAdmin({ config, basePath });
  const t = (i18n: AdminI18n) => i18n.scope(templatesMessages).t;
  const group = options.group ?? ((i18n: AdminI18n) => t(i18n)("nav.group"));
  return {
    catalogs: [templatesMessages],
    pages: [
      {
        path: "templates",
        label: (i18n) => t(i18n)("nav.templates"),
        group,
        component: createTemplatesPage(config, key),
      },
      {
        path: "brand",
        label: (i18n) => t(i18n)("nav.brand"),
        group,
        component: createBrandPage(config, key),
      },
    ],
  };
}

export { templatesMessages } from "./messages";

export type { ActionResult } from "./actions";
export type { FeedbackErrorCode } from "./feedback";
export type { TemplatesMessageKey } from "./messages";
export type { WorkspaceActions, WorkspaceProps } from "./workspace";
