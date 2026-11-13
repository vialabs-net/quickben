import { normalizeBasePath } from "./base-path";
import { createBrandPage } from "./brand-page";
import { registerTemplatesAdmin } from "./registry";
import { createTemplatesPage } from "./templates-page";

import type { AdminExtension } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

/** Options of {@link templatesAdmin}. */
export interface TemplatesAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the pages. Default `Documents`. */
  group?: string;
}

/**
 * Admin UI for the templates plugin: a Templates page (list of kinds, and an editor with a
 * variable panel, live preview and publishing at `templates/<kind>`) and a Brand page.
 *
 * ```tsx
 * export default createAdminPage(config, { extensions: [templatesAdmin(config)] });
 * ```
 *
 * Import `@quickben/plugin-templates/styles.css` next to `@quickben/admin/styles.css`.
 */
export function templatesAdmin(
  config: QuickbenConfig,
  options: TemplatesAdminOptions = {},
): AdminExtension {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerTemplatesAdmin({ config, basePath });
  const group = options.group ?? "Documents";
  return {
    pages: [
      { path: "templates", label: "Templates", group, component: createTemplatesPage(config, key) },
      { path: "brand", label: "Brand", group, component: createBrandPage(config, key) },
    ],
  };
}

export type { ActionResult } from "./actions";
export type { WorkspaceActions, WorkspaceProps } from "./workspace";
