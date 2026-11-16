/**
 * The generic field inputs and form parsing of the admin, for plugin and host pages that
 * render collection fields in their own forms and save them with their own server actions.
 *
 * ```tsx
 * import { FieldInput, loadFieldContext, parseFormData } from "@quickben/admin/forms";
 * ```
 */
import { collectionMeta } from "@quickben/next";

import { DEFAULT_API_BASE_PATH, fileUrls } from "./files";
import { loadRelationOptions } from "./load";

import type { AdminI18n } from "./i18n/translator";
import type { AdminServerFunction, FieldComponentProps } from "./types";
import type { FieldInputContext } from "./views/field-input";
import type { Quickben, RequestContext } from "@quickben/core";
import type { CollectionMeta } from "@quickben/next";
import type { ComponentType } from "react";

export { editableFields, issuesToErrors, parseFormData } from "./form-data";
export { controlId, formScope } from "./ids";
export { FieldInput } from "./views/field-input";

export type { IssuesToErrorsOptions } from "./form-data";
export type { FieldInputContext } from "./views/field-input";

/** Arguments of {@link loadFieldContext}. */
export interface LoadFieldContextArgs {
  qb: Quickben;
  ctx: RequestContext;
  /** The collection, from `collectionMeta` of `@quickben/next`. */
  collection: CollectionMeta;
  /** The stored document, or `null` on create. Used for the labels of selected relations. */
  doc: Record<string, unknown> | null;
  /** Server function for relation searches: `PageProps.serverFunction` on admin pages. */
  serverFunction: AdminServerFunction;
  /** Scope of the control ids, from {@link formScope}. Unique per form on the page. */
  scope: string;
  i18n: AdminI18n;
  /** Custom field components by name. */
  components?: Readonly<Record<string, ComponentType<FieldComponentProps>>>;
  /** The whole form is read-only. Field access still applies per field. Default `false`. */
  readOnly?: boolean;
  /** URL path of the route handlers, for file previews. Default `/api`. */
  apiBasePath?: string;
}

/**
 * Everything {@link FieldInput} needs besides the field: labels of the selected relations,
 * control ids and i18n. Only the collections that relation fields point to are described.
 */
export async function loadFieldContext(args: LoadFieldContextArgs): Promise<FieldInputContext> {
  const { qb, ctx, collection, doc, i18n } = args;
  const related = [
    ...new Set(collection.fields.flatMap((field) => (field.to === undefined ? [] : [field.to]))),
  ];
  const described = await Promise.all(
    related.map(async (slug) => {
      const target = qb.collections[slug];
      return target ? collectionMeta(target, ctx, { locale: i18n.locale }) : null;
    }),
  );
  const metas = new Map(
    described.filter((meta) => meta !== null).map((meta) => [meta.slug, meta] as const),
  );
  return {
    components: args.components ?? {},
    relationOptions: await loadRelationOptions(qb, ctx, collection, doc, metas),
    serverFunction: args.serverFunction,
    labels: Object.fromEntries([...metas.values()].map((meta) => [meta.slug, meta.labels.plural])),
    files: fileUrls(
      args.apiBasePath ?? DEFAULT_API_BASE_PATH,
      collection.slug,
      doc,
      collection.fields,
    ),
    readOnly: args.readOnly ?? false,
    scope: args.scope,
    i18n,
  };
}
