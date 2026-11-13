import { checkAccess } from "@quickben/core";

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
}

/** A collection as described by `GET /_meta`. Read access is implied: unreadable ones are left out. */
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

function fieldMeta(field: SanitizedField): FieldMeta {
  return {
    name: field.name,
    type: field.type,
    label: field.label,
    description: field.description ?? null,
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
): Promise<CollectionMeta | null> {
  if (!(await allowed(collection, "read", ctx))) return null;
  const [create, update, remove] = await Promise.all([
    allowed(collection, "create", ctx),
    allowed(collection, "update", ctx),
    allowed(collection, "delete", ctx),
  ]);
  return {
    slug: collection.slug,
    labels: { singular: collection.labels.singular, plural: collection.labels.plural },
    fields: collection.fieldList.map(fieldMeta),
    admin: {
      useAsTitle: collection.admin.useAsTitle ?? "id",
      defaultColumns: collection.admin.defaultColumns ? [...collection.admin.defaultColumns] : null,
      group: collection.admin.group ?? null,
      hidden: collection.admin.hidden ?? false,
      description: collection.admin.description ?? null,
    },
    access: { create, update, delete: remove },
  };
}

/**
 * Describe the collections and modules a user can read. Used by `GET /_meta` and the admin UI.
 * Access rules run without a document, so a rule that returns a filter counts as allowed.
 */
export async function getMeta(qb: Quickben, ctx: RequestContext): Promise<MetaResponse> {
  const described = await Promise.all(
    qb.config.collections.map((collection) => collectionMeta(collection, ctx)),
  );
  const collections = described.filter((meta) => meta !== null);
  const readable = new Set(collections.map((meta) => meta.slug));
  const modules: ModuleMeta[] = [];
  for (const module of qb.config.modules) {
    const slugs = module.collections.filter((slug) => readable.has(slug));
    const nav = (module.nav ?? [])
      .filter((item) => item.collection === undefined || readable.has(item.collection))
      .map((item) => ({ ...item }));
    if (slugs.length === 0 && nav.length === 0) continue;
    modules.push({ key: module.key, label: module.label, collections: slugs, nav });
  }
  return { title: qb.config.admin.title, user: ctx.user, collections, modules };
}
