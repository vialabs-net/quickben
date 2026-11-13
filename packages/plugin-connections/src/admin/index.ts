import { CONNECTIONS, CREDENTIALS } from "../options";

import { createConnectionEdit, createConnectionsList } from "./connections";
import { createCredentialEdit, createCredentialsList } from "./credentials";
import { normalizeBasePath, registerConnectionsAdmin } from "./registry";

import type { AdminExtension } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

export { ProviderMark, TestBadge } from "./shared";
export { describeFields, describeProvider } from "./describe";

export type { FieldView, ProviderView } from "./describe";

/** Options of {@link connectionsAdmin}. */
export interface ConnectionsAdminOptions {
  /** Same as `createAdminPage`'s `basePath`. Default `/admin`. */
  basePath?: string;
}

/**
 * Admin UI for the connections plugin. Replaces the list and edit views of `connections` and
 * `credentials` (sidebar group `Integrations` by default): a provider picker grouped by
 * category, forms built from each provider's schema, Test buttons with toasts, and a test
 * dialog for credentials no connection uses yet.
 *
 * ```tsx
 * export default createAdminPage(config, { extensions: [connectionsAdmin(config)] });
 * ```
 *
 * Every change goes through the local API, so access rules apply. Secrets are write-only.
 */
export function connectionsAdmin(
  config: QuickbenConfig,
  options: ConnectionsAdminOptions = {},
): AdminExtension {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const key = registerConnectionsAdmin({ config, basePath });
  return {
    views: {
      [CONNECTIONS]: {
        list: createConnectionsList(config, key),
        edit: createConnectionEdit(config, key),
      },
      [CREDENTIALS]: {
        list: createCredentialsList(config),
        edit: createCredentialEdit(config, key),
      },
    },
  };
}
