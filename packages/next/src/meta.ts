import { checkAccess, checkFieldAccess, localize } from "@quickben/core";

import type {
  AccessOperation,
  FieldAdmin,
  FieldType,
  QuickbenUser,
  Quickben,
  RequestContext,
  SanitizedCollection,
  SanitizedField,
} from "@quickben/core";

/** A field as described by `GET /_meta`. Functions (`validate`, `default` functions) are left out. */
export interface FieldMeta {
  name: string;
  type: FieldType;
  label: string;
  description: string | null;
  required: boolean;
  many: boolean;
  unique: boolean;
  /** Static default value. Absent when there is none or it is a function. */
  default?: unknown;
  /** Allowed values of `select` fields. */
  options?: readonly string[];
  /** Related collection of `relation` fields. */
  to?: string;
  integer?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  admin: FieldAdmin;
  /** Time zone of `date` and `datetime` inputs given with offsets or as `Date`. */
  timeZone?: string;
  /** Accepted types of `file` fields. Absent when every type is accepted. */
  accept?: readonly string[];
  /** Largest file of `file` fields, in bytes. */
  maxBytes?: number;
  /** Whether the user may set the field on create and on update (field access rules). */
  access: { create: boolean; update: boolean };
}

/**
 * A collection as described by `GET /_meta`. Read access is implied: unreadable collections
 * and fields are left out.
 */
export interface CollectionMeta {
  slug: string;
  labels: { singular: string; plural: string };
  fields: FieldMeta[];
  admin: {
    useAsTitle: string;
    defaultColumns: string[] | null;
    group: string | null;
    hidden: boolean;
    description: string | null;
  };
  /** Whether the user may create, update and delete. `true` can still be limited by a filter. */
  access: Record<Exclude<AccessOperation, "read">, boolean>;
}

/** A module as described by `GET /_meta`, limited to what the user can read. */
export interface ModuleMeta {
  key: string;
  label: string;
  collections: string[];
  nav: { label: string; collection?: string; href?: string }[];
}

/** Body of `GET /_meta`. */
export interface MetaResponse {
  title: string;
  user: QuickbenUser | null;
  collections: CollectionMeta[];
  modules: ModuleMeta[];
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** Options of {@link getMeta} and {@link collectionMeta}. */
export interface MetaOptions {
  /** Locale for labels given per locale. Default: English, then the first value. */
  locale?: string;
}

interface FieldDenials {
  create: ReadonlySet<string>;
  update: ReadonlySet<string>;
}

function fieldMeta(
  field: SanitizedField,
  locale: string | undefined,
  denied: FieldDenials,
): FieldMeta {
  return {
    name: field.name,
    type: field.type,
    label: localize(field.label, locale),
    description: field.description === undefined ? null : localize(field.description, locale),
    required: field.required,
    many: field.many,
    unique: field.unique,
    ...(typeof field.default === "function" ? {} : optional("default", field.default)),
    ...(field.type === "select" ? { options: field.options } : {}),
    ...(field.type === "relation" ? { to: field.to } : {}),
    ...(field.type === "number"
      ? { integer: field.integer, ...optional("min", field.min), ...optional("max", field.max) }
      : {}),
    ...("minLength" in field ? optional("minLength", field.minLength) : {}),
    ...("maxLength" in field ? optional("maxLength", field.maxLength) : {}),
    admin: field.admin,
    ...(field.type === "date" || field.type === "datetime"
      ? optional("timeZone", field.timeZone)
      : {}),
    ...(field.type === "file"
      ? { ...optional("accept", field.accept), maxBytes: field.maxBytes }
      : {}),
    access: { create: !denied.create.has(field.name), update: !denied.update.has(field.name) },
  };
}

async function allowed(
  collection: SanitizedCollection,
  operation: AccessOperation,
  ctx: RequestContext,
): Promise<boolean> {
  return (await checkAccess(collection, operation, ctx)) !== false;
}

/** Describe one collection for a user, or return `null` when the user cannot read it. */
export async function collectionMeta(
  collection: SanitizedCollection,
  ctx: RequestContext,
  options: MetaOptions = {},
): Promise<CollectionMeta | null> {
  const { locale } = options;
  if (!(await allowed(collection, "read", ctx))) return null;
  const [create, update, remove, hidden, createDenied, updateDenied] = await Promise.all([
    allowed(collection, "create", ctx),
    allowed(collection, "update", ctx),
    allowed(collection, "delete", ctx),
    checkFieldAccess(collection, "read", ctx),
    checkFieldAccess(collection, "create", ctx),
    checkFieldAccess(collection, "update", ctx),
  ]);
  const denied = { create: createDenied, update: updateDenied };
  const readable = (name: string) => !hidden.has(name);
  const useAsTitle = collection.admin.useAsTitle ?? "id";
  return {
    slug: collection.slug,
    labels: {
      singular: localize(collection.labels.singular, locale),
      plural: localize(collection.labels.plural, locale),
    },
    fields: collection.fieldList
      .filter((field) => readable(field.name))
      .map((field) => fieldMeta(field, locale, denied)),
    admin: {
      useAsTitle: readable(useAsTitle) ? useAsTitle : "id",
      defaultColumns: collection.admin.defaultColumns
        ? collection.admin.defaultColumns.filter(readable)
        : null,
      group: collection.admin.group === undefined ? null : localize(collection.admin.group, locale),
      hidden: collection.admin.hidden ?? false,
      description:
        collection.admin.description === undefined
          ? null
          : localize(collection.admin.description, locale),
    },
    access: { create, update, delete: remove },
  };
}

/**
 * Describe the collections and modules a user can read. Used by `GET /_meta` and the admin UI.
 * Access rules run without a document, so a rule that returns a filter counts as allowed.
 */
export async function getMeta(
  qb: Quickben,
  ctx: RequestContext,
  options: MetaOptions = {},
): Promise<MetaResponse> {
  const { locale } = options;
  const described = await Promise.all(
    qb.config.collections.map((collection) => collectionMeta(collection, ctx, options)),
  );
  const collections = described.filter((meta) => meta !== null);
  const readable = new Set(collections.map((meta) => meta.slug));
  const modules: ModuleMeta[] = [];
  for (const module of qb.config.modules) {
    const slugs = module.collections.filter((slug) => readable.has(slug));
    const nav = (module.nav ?? [])
      .filter((item) => item.collection === undefined || readable.has(item.collection))
      .map((item) => ({ ...item, label: localize(item.label, locale) }));
    if (slugs.length === 0 && nav.length === 0) continue;
    modules.push({
      key: module.key,
      label: localize(module.label, locale),
      collections: slugs,
      nav,
    });
  }
  return { title: localize(qb.config.admin.title, locale), user: ctx.user, collections, modules };
}
