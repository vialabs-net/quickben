import { normalizeBasePath } from "./base-path";
import { createQueuePage } from "./queue-page";
import { registerDocReaderAdmin } from "./registry";
import { createTypesPage } from "./types-page";
import { createUsagePage } from "./usage-page";

import type { AdminExtension } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

/** Options of {@link docReaderAdmin}. */
export interface DocReaderAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
  /** Sidebar group of the pages. Default `Documents`. */
  group?: string;
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
  const group = options.group ?? "Documents";
  return {
    pages: [
      {
        path: "document-types",
        label: "Document types",
        group,
        component: createTypesPage(config, key),
      },
      { path: "document-queue", label: "Readings", group, component: createQueuePage(config, key) },
      { path: "document-usage", label: "Usage", group, component: createUsagePage(config, key) },
    ],
  };
}
