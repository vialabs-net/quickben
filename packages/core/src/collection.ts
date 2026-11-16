import { ConfigError } from "./errors";
import { fields } from "./fields";
import { mapLocalized } from "./localize";
import { isTimeZone } from "./time";

import type { AnyField, Fields } from "./fields";
import type {
  AnyCollection,
  BeforeChangeHook,
  Collection,
  CollectionConfig,
  CollectionHooks,
  TrackAuthorFields,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- an empty set of fields
type NoFields = Record<never, AnyField>;

const slugPattern = /^[a-z][a-z0-9_-]{0,62}$/;
const fieldNamePattern = /^[A-Za-z]\w{0,62}$/;
const reservedFieldNames = new Set(["id", "createdat", "updatedat", "and", "or"]);

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

/**
 * Check field names and options. Names are compared without case, because SQL databases such
 * as SQLite treat `title` and `Title` as the same column.
 */
function assertFields(slug: string, fields: Fields, existing: readonly string[] = []): void {
  const seen = new Set(existing.map((name) => name.toLowerCase()));
  for (const [name, field] of Object.entries(fields)) {
    if (!fieldNamePattern.test(name)) {
      throw new ConfigError(
        `Invalid field name "${name}" in collection "${slug}". Use letters, digits and "_", starting with a letter.`,
      );
    }
    if (reservedFieldNames.has(name.toLowerCase())) {
      throw new ConfigError(`Field name "${name}" in collection "${slug}" is reserved`);
    }
    if (seen.has(name.toLowerCase())) {
      throw new ConfigError(`Field "${slug}.${name}" differs from another field only in case`);
    }
    seen.add(name.toLowerCase());
    assertFieldOptions(`${slug}.${name}`, field);
  }
}

function assertFieldOptions(path: string, field: AnyField): void {
  if (field.unique && field.many) {
    throw new ConfigError(`Field "${path}" cannot be both unique and many`);
  }
  const timeZone = field.type === "date" || field.type === "datetime" ? field.timeZone : undefined;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    throw new ConfigError(`Field "${path}" has an unknown time zone "${timeZone}"`);
  }
  if (field.type === "select" && field.options.length === 0) {
    throw new ConfigError(`Select field "${path}" needs at least one option`);
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
export function defineCollection<
  const TSlug extends string,
  F extends Fields,
  const TTrackAuthor extends boolean = false,
>(
  config: CollectionConfig<TSlug, F> & { trackAuthor?: TTrackAuthor },
): Collection<TSlug, TTrackAuthor extends true ? F & TrackAuthorFields : F> {
  if (!slugPattern.test(config.slug)) {
    throw new ConfigError(
      `Invalid collection slug "${config.slug}". Use lowercase letters, digits, "-" and "_", starting with a letter.`,
    );
  }
  assertFields(config.slug, config.fields);
  const plural = config.labels?.plural ?? humanize(config.slug);
  const collection: Collection<TSlug, F> = {
    slug: config.slug,
    labels: { singular: config.labels?.singular ?? mapLocalized(plural, singularize), plural },
    fields: config.fields,
    access: config.access ?? {},
    hooks: config.hooks ?? {},
    admin: config.admin ?? {},
    ...(config.api ? { api: config.api } : {}),
  };
  const trackAuthor: boolean = config.trackAuthor ?? false;
  return (trackAuthor ? withAuthor(collection) : collection) as Collection<
    TSlug,
    TTrackAuthor extends true ? F & TrackAuthorFields : F
  >;
}

function authorField(): TrackAuthorFields["createdBy"] {
  const deny = () => false;
  return fields.text({ admin: { readOnly: true }, access: { create: deny, update: deny } });
}

/** Set `createdBy` and `updatedBy` from the user. Values given by trusted code are kept. */
const setAuthor: BeforeChangeHook = ({ data, operation, user }) => {
  const id = user?.id ?? null;
  if (operation === "create") {
    return { ...data, createdBy: data.createdBy ?? id, updatedBy: data.updatedBy ?? id };
  }
  return id === null || data.updatedBy !== undefined ? data : { ...data, updatedBy: id };
};

function withAuthor(collection: AnyCollection): AnyCollection {
  const added: TrackAuthorFields = { createdBy: authorField(), updatedBy: authorField() };
  assertFields(collection.slug, added, Object.keys(collection.fields));
  return {
    ...collection,
    fields: { ...collection.fields, ...added },
    hooks: {
      ...collection.hooks,
      beforeChange: [setAuthor, ...(collection.hooks.beforeChange ?? [])],
    },
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
  assertFields(collection.slug, extra, Object.keys(collection.fields));
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
