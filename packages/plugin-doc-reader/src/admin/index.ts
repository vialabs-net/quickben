import { normalizeBasePath } from "./base-path";
import { docReaderMessages, docReaderT } from "./messages";
import { createQueuePage } from "./queue-page";
import { registerDocReaderAdmin } from "./registry";
import { createTypesPage } from "./types-page";
import { createUsagePage } from "./usage-page";

import type { AdminExtension, AdminText } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

/** Options of {@link docReaderAdmin}. */
export interface DocReaderAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the pages, as given. Default `Documents`, translated. */
  group?: AdminText;
}

/**
 * Admin UI for the doc reader: Document types (editor, test bench, model comparison,
 * publishing), Usage (spend, budgets, platform cap) and Readings (the queue and each reading).
 *
 * ```tsx
 * export default createAdminPage(config, { extensions: [docReaderAdmin(config)] });
 * ```
 *
 * Every change goes through the plugin's functions, so access rules and studio rules apply.
 */
export function docReaderAdmin(
  config: QuickbenConfig,
  options: DocReaderAdminOptions = {},
): AdminExtension {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerDocReaderAdmin({ config, basePath });
  const group = options.group ?? ((i18n) => docReaderT(i18n)("nav.group"));
  return {
    catalogs: [docReaderMessages],
    pages: [
      {
        path: "document-types",
        label: (i18n) => docReaderT(i18n)("nav.types"),
        group,
        component: createTypesPage(config, key),
      },
      {
        path: "document-queue",
        label: (i18n) => docReaderT(i18n)("nav.readings"),
        group,
        component: createQueuePage(config, key),
      },
      {
        path: "document-usage",
        label: (i18n) => docReaderT(i18n)("nav.usage"),
        group,
        component: createUsagePage(config, key),
      },
    ],
  };
}

export { docReaderMessages } from "./messages";
