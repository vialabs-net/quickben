import { extendCollection, humanize } from "./collection";
import { ConfigError } from "./errors";
import { defaultTimeZone, isTimeZone } from "./time";

import type { FileField } from "./fields";
import type {
  AnyCollection,
  AnyPlugin,
  ConfigInput,
  ConfigRegistry,
  FieldExtensions,
  InitHook,
  Module,
  Plugin,
  PluginConfig,
  QuickbenConfig,
  SanitizedCollection,
  SanitizedField,
} from "./types";

/**
 * Define the app config. Plugins run here, in the order listed. The result is typed by
 * collection slug, so `qb.find("posts", …)` knows the document type.
 */
export function defineConfig<
  const C extends readonly AnyCollection[],
  const P extends readonly AnyPlugin[] = [],
>(input: ConfigInput<C, P>): QuickbenConfig<ConfigRegistry<C[number], P[number]>> {
  let config: PluginConfig = {
    db: input.db,
    storage: input.storage,
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
  const timeZone = input.timeZone ?? defaultTimeZone;
  if (!isTimeZone(timeZone)) throw new ConfigError(`Unknown time zone "${timeZone}"`);
  const collections = config.collections.map((collection) =>
    sanitizeCollection(collection, timeZone),
  );
  assertConfig(collections, config.modules);
  return {
    db: config.db,
    storage: config.storage,
    collections,
    auth: config.auth,
    admin: {
      ...config.admin,
      title: config.admin.title ?? "Quickben",
      meta: config.admin.meta ?? {},
    },
    modules: config.modules,
    onInit: config.onInit,
    plugins: config.plugins,
    timeZone,
  };
}

/**
 * Resolve names, labels and time zones. `fields` holds the same sanitized objects as
 * `fieldList`, so code that looks a field up by name sees its resolved time zone.
 */
function sanitizeCollection(collection: AnyCollection, timeZone: string): SanitizedCollection {
  const fieldList = Object.entries(collection.fields).map(([name, field]): SanitizedField => ({
    ...field,
    ...(field.type === "date" || field.type === "datetime"
      ? { timeZone: field.timeZone ?? timeZone }
      : {}),
    // Fields built without `fields.*` (plain objects in plugins and tests) may omit `access`.
    access: (field as Partial<typeof field>).access ?? {},
    name,
    label: field.label ?? humanize(name),
  }));
  return {
    ...collection,
    fields: Object.fromEntries(fieldList.map((field) => [field.name, field])),
    fieldList,
  };
}

function assertConfig(collections: readonly SanitizedCollection[], modules: readonly Module[]) {
  const slugs = new Set<string>();
  for (const collection of collections) {
    if (slugs.has(collection.slug)) {
      throw new ConfigError(`Duplicate collection slug "${collection.slug}"`);
    }
    slugs.add(collection.slug);
  }
  for (const collection of collections) assertFields(collection, slugs);
  assertModules(modules, slugs);
}

/** Check relation targets and file field options. */
function assertFields(collection: SanitizedCollection, slugs: ReadonlySet<string>) {
  for (const field of collection.fieldList) {
    if (field.type === "file") assertFileField(collection.slug, field);
    if (field.type === "relation" && !slugs.has(field.to)) {
      throw new ConfigError(
        `Field "${collection.slug}.${field.name}" relates to unknown collection "${field.to}"`,
      );
    }
  }
}

function assertFileField(slug: string, field: FileField & { name: string }) {
  const name = `${slug}.${field.name}`;
  if (!Number.isInteger(field.maxBytes) || field.maxBytes <= 0) {
    throw new ConfigError(`Field "${name}": maxBytes must be a positive integer`);
  }
  if (field.accept?.some((type) => !/^[\w.+-]+\/([\w.+-]+|\*)$/.test(type))) {
    throw new ConfigError(
      `Field "${name}": accept lists MIME types such as "image/png" or "image/*"`,
    );
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
export interface PluginDefinition<
  C extends readonly AnyCollection[],
  X extends FieldExtensions = FieldExtensions,
> {
  /** Unique plugin name. A plugin cannot be applied twice. */
  name: string;
  /** Collections to add. */
  collections?: C;
  /**
   * Fields to add to existing collections, keyed by slug: `{ posts: { org: fields.text() } }`.
   * Runs after `collections` are added. The fields are typed in the registry. An unknown slug
   * throws `ConfigError`.
   */
  addFields?: X;
  /** Change the collections (yours and the ones added before). Runs after `addFields`. */
  extendCollections?: (collections: readonly AnyCollection[]) => readonly AnyCollection[];
  /** Modules to register. */
  modules?: readonly Module[];
  /** Runs once after the database is ready. */
  onInit?: InitHook;
}

/**
 * Define a plugin. The result is a `(config) => config` function that adds collections, adds
 * fields, changes collections, registers modules and init hooks, in that order.
 */
export function definePlugin<
  const C extends readonly AnyCollection[] = [],
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no fields added
  const X extends FieldExtensions = {},
>(definition: PluginDefinition<C, X>): Plugin<C[number], X> {
  const plugin = (config: PluginConfig): PluginConfig => {
    if (config.plugins.includes(definition.name)) {
      throw new ConfigError(`Plugin "${definition.name}" is applied twice`);
    }
    const added = addFields(
      definition.name,
      [...config.collections, ...(definition.collections ?? [])],
      definition.addFields,
    );
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

function addFields(
  pluginName: string,
  collections: readonly AnyCollection[],
  extensions: FieldExtensions | undefined,
): readonly AnyCollection[] {
  if (!extensions) return collections;
  for (const slug of Object.keys(extensions)) {
    if (!collections.some((collection) => collection.slug === slug)) {
      throw new ConfigError(
        `Plugin "${pluginName}" adds fields to unknown collection "${slug}". List the plugin after the one that adds it.`,
      );
    }
  }
  return collections.map((collection) => {
    const fields = extensions[collection.slug];
    return fields ? extendCollection(collection, { fields }) : collection;
  });
}
