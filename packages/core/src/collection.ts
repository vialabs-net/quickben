import { ConfigError } from "./errors";

import type { AnyField, Fields } from "./fields";
import type { AnyCollection, Collection, CollectionConfig, CollectionHooks } from "./types";

// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- an empty set of fields
type NoFields = Record<never, AnyField>;

const slugPattern = /^[a-z][a-z0-9_-]{0,62}$/;
const fieldNamePattern = /^[A-Za-z]\w{0,62}$/;
const reservedFieldNames = new Set(["id", "createdAt", "updatedAt", "and", "or"]);

/** Turn `publishedAt`, `first_name` or `blog-posts` into `Published at`, `First name`, `Blog posts`. */
export function humanize(name: string): string {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function singularize(plural: string): string {
  if (plural.endsWith("ies")) return `${plural.slice(0, -3)}y`;
  if (plural.endsWith("ss")) return plural;
  if (plural.endsWith("s")) return plural.slice(0, -1);
  return plural;
}

function assertFields(slug: string, fields: Fields): void {
  for (const [name, field] of Object.entries(fields)) {
    if (!fieldNamePattern.test(name)) {
      throw new ConfigError(
        `Invalid field name "${name}" in collection "${slug}". Use letters, digits and "_", starting with a letter.`,
      );
    }
    if (reservedFieldNames.has(name)) {
      throw new ConfigError(`Field name "${name}" in collection "${slug}" is reserved`);
    }
    if (field.unique && field.many) {
      throw new ConfigError(`Field "${slug}.${name}" cannot be both unique and many`);
    }
    if (field.type === "select" && field.options.length === 0) {
      throw new ConfigError(`Select field "${slug}.${name}" needs at least one option`);
    }
  }
}

/**
 * Define a collection. Types of documents, inputs and filters are inferred from `fields`.
 *
 * ```ts
 * const posts = defineCollection({
 *   slug: "posts",
 *   fields: { title: fields.text({ required: true }) },
 *   access: { read: () => true },
 * });
 * ```
 */
export function defineCollection<const TSlug extends string, F extends Fields>(
  config: CollectionConfig<TSlug, F>,
): Collection<TSlug, F> {
  if (!slugPattern.test(config.slug)) {
    throw new ConfigError(
      `Invalid collection slug "${config.slug}". Use lowercase letters, digits, "-" and "_", starting with a letter.`,
    );
  }
  assertFields(config.slug, config.fields);
  const plural = config.labels?.plural ?? humanize(config.slug);
  return {
    slug: config.slug,
    labels: { singular: config.labels?.singular ?? singularize(plural), plural },
    fields: config.fields,
    access: config.access ?? {},
    hooks: config.hooks ?? {},
    admin: config.admin ?? {},
  };
}

/**
 * Return a copy of a collection with more fields and hooks. Hooks run after the existing ones.
 * For plugins: `extendCollection(posts, { fields: { organization: fields.relation({ to: "organizations" }) } })`.
 */
export function extendCollection<C extends AnyCollection, TExtra extends Fields = NoFields>(
  collection: C,
  extension: { fields?: TExtra; hooks?: CollectionHooks<C["fields"] & TExtra> },
): Collection<C["slug"], C["fields"] & TExtra> {
  const extra = extension.fields ?? ({} as TExtra);
  for (const name of Object.keys(extra)) {
    if (Object.hasOwn(collection.fields, name)) {
      throw new ConfigError(`Field "${collection.slug}.${name}" already exists`);
    }
  }
  assertFields(collection.slug, extra);
  const hooks: Record<string, readonly unknown[]> = { ...collection.hooks };
  for (const [stage, list] of Object.entries(extension.hooks ?? {})) {
    hooks[stage] = [...(hooks[stage] ?? []), ...(list as readonly unknown[])];
  }
  return {
    ...collection,
    fields: { ...collection.fields, ...extra },
    hooks,
  } as unknown as Collection<C["slug"], C["fields"] & TExtra>;
}
