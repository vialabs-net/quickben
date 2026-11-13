import { definePlugin, fields as f } from "@quickben/core";

import { membershipsCollection, organizationsCollection } from "./collections";
import { ORGANIZATIONS, register, resolveOptions } from "./options";
import { scopeCollection } from "./scope";

import type { MembershipsCollection, OrganizationsCollection, TenancyState } from "./collections";
import type { TenancyOptions } from "./options";
import type { Plugin, RelationField } from "@quickben/core";

/**
 * The `organization` field added to every tenant-scoped collection. Required and indexed. Create
 * input may leave it out: the plugin fills it from the active organization.
 */
export type OrganizationField = RelationField<typeof ORGANIZATIONS, false, true, true>;

/** Fields the plugin adds, keyed by scoped slug. */
export type ScopedFields<S extends string> = Record<S, { organization: OrganizationField }>;

/** The plugin returned by {@link tenancy}. */
export type TenancyPlugin<S extends string> = Plugin<
  OrganizationsCollection | MembershipsCollection,
  ScopedFields<S>
>;

/**
 * Multi-tenancy. Adds `organizations` and `memberships`, an `organization` field on each
 * collection in `scope`, and access rules that keep every read and write inside the active
 * organization.
 *
 * List it after the plugins that add scoped collections.
 */
export function tenancy<const S extends string>(options: TenancyOptions<S>): TenancyPlugin<S> {
  const state: TenancyState = { tenancy: resolveOptions(options), rootQb: undefined };
  const scope = new Set<string>(state.tenancy.scope);
  const organizationField = (): OrganizationField =>
    f.relation({
      to: ORGANIZATIONS,
      required: true,
      index: true,
      admin: { readOnly: true },
    }) as unknown as OrganizationField;
  const addFields = Object.fromEntries(
    state.tenancy.scope.map((slug) => [slug, { organization: organizationField() }]),
  ) as ScopedFields<S>;

  return definePlugin({
    name: "tenancy",
    collections: [organizationsCollection(state), membershipsCollection(state)],
    addFields,
    extendCollections: (collections) =>
      collections.map((collection) =>
        scope.has(collection.slug) ? scopeCollection(state, collection) : collection,
      ),
    onInit: (qb) => {
      state.rootQb = qb;
      register(qb.config, state.tenancy);
    },
  });
}
