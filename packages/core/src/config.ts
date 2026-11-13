import { humanize } from "./collection";
import { ConfigError } from "./errors";

import type {
  AnyCollection,
  ConfigInput,
  InitHook,
  Module,
  Plugin,
  PluginCollections,
  PluginConfig,
  QuickbenConfig,
  RegistryOf,
  SanitizedCollection,
  SanitizedField,
} from "./types";

/**
 * Define the app config. Plugins run here, in the order listed. The result is typed by
 * collection slug, so `qb.find("posts", …)` knows the document type.
 */
export function defineConfig<
  const C extends readonly AnyCollection[],
  const P extends readonly Plugin<AnyCollection>[] = [],
>(input: ConfigInput<C, P>): QuickbenConfig<RegistryOf<C[number] | PluginCollections<P[number]>>> {
  let config: PluginConfig = {
    db: input.db,
    collections: [...input.collections],
    auth: input.auth,
    admin: input.admin ?? {},
    modules: [...(input.modules ?? [])],
    onInit: [],
    plugins: [],
  };
  for (const plugin of input.plugins ?? []) {
    config = plugin(config);
  }
  const collections = config.collections.map(sanitizeCollection);
  assertConfig(collections, config.modules);
  return {
    db: config.db,
    collections,
    auth: config.auth,
    admin: { title: config.admin.title ?? "Quickben", meta: config.admin.meta ?? {} },
    modules: config.modules,
    onInit: config.onInit,
    plugins: config.plugins,
  };
}

function sanitizeCollection(collection: AnyCollection): SanitizedCollection {
  const fieldList = Object.entries(collection.fields).map(([name, field]): SanitizedField => ({
    ...field,
    name,
    label: field.label ?? humanize(name),
  }));
  return { ...collection, fieldList };
}

function assertConfig(collections: readonly SanitizedCollection[], modules: readonly Module[]) {
  const slugs = new Set<string>();
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      throw new ConfigError(`Duplicate collection slug "${collection.slug}"`);
    }
    slugs.add(collection.slug);
  }
  for (const collection of collections) assertRelations(collection, slugs);
  assertModules(modules, slugs);
}

function assertRelations(collection: SanitizedCollection, slugs: ReadonlySet<string>) {
  for (const field of collection.fieldList) {
    if (field.type === "relation" && !slugs.has(field.to)) {
      throw new ConfigError(
        `Field "${collection.slug}.${field.name}" relates to unknown collection "${field.to}"`,
      );
    }
  }
}

function assertModules(modules: readonly Module[], slugs: ReadonlySet<string>) {
  const keys = new Set<string>();
  for (const module of modules) {
    if (keys.has(module.key)) throw new ConfigError(`Duplicate module key "${module.key}"`);
    keys.add(module.key);
    for (const slug of module.collections) {
      if (!slugs.has(slug)) {
        throw new ConfigError(`Module "${module.key}" lists unknown collection "${slug}"`);
      }
    }
  }
}

/** Input of {@link definePlugin}. */
export interface PluginDefinition<C extends readonly AnyCollection[]> {
  /** Unique plugin name. A plugin cannot be applied twice. */
  name: string;
  /** Collections to add. */
  collections?: C;
  /** Change the collections (yours and the ones added before). Runs after `collections` are added. */
  extendCollections?: (collections: readonly AnyCollection[]) => readonly AnyCollection[];
  /** Modules to register. */
  modules?: readonly Module[];
  /** Runs once after the database is ready. */
  onInit?: InitHook;
}

/**
 * Define a plugin. The result is a `(config) => config` function that adds collections,
 * changes collections, registers modules and init hooks, in that order.
 */
export function definePlugin<const C extends readonly AnyCollection[] = []>(
  definition: PluginDefinition<C>,
): Plugin<C[number]> {
  const plugin = (config: PluginConfig): PluginConfig => {
    if (config.plugins.includes(definition.name)) {
      throw new ConfigError(`Plugin "${definition.name}" is applied twice`);
    }
    const added = [...config.collections, ...(definition.collections ?? [])];
    return {
      ...config,
      collections: definition.extendCollections ? definition.extendCollections(added) : added,
      modules: [...config.modules, ...(definition.modules ?? [])],
      onInit: definition.onInit ? [...config.onInit, definition.onInit] : config.onInit,
      plugins: [...config.plugins, definition.name],
    };
  };
  return plugin;
}
