import { definePlugin } from "@quickben/core";

import { connectionsCollection, credentialsCollection } from "./collections";
import { register, resolveOptions } from "./options";

import type { ConnectionsCollection, CredentialsCollection } from "./collections";
import type { ConnectionsOptions } from "./options";
import type { Plugin } from "@quickben/core";

/** The plugin returned by {@link connections}. */
export type ConnectionsPlugin = Plugin<CredentialsCollection | ConnectionsCollection>;

/**
 * Connections and credentials. Adds the `credentials` collection (encrypted secrets that no
 * read returns) and the `connections` collection (a provider endpoint, its settings and the
 * credential it uses).
 *
 * ```ts
 * connections({ masterKey: process.env.QUICKBEN_MASTER_KEY });
 * ```
 */
export function connections(options: ConnectionsOptions = {}): ConnectionsPlugin {
  const state = resolveOptions(options);
  return definePlugin({
    name: "connections",
    collections: [credentialsCollection(state), connectionsCollection(state)],
    onInit: (qb) => {
      register(qb.config, state);
    },
  });
}
