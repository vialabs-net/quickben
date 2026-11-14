import { FieldInput, formScope, loadFieldContext } from "@quickben/admin/forms";
import { collectionMeta } from "@quickben/next";

import type { AdminI18n, AdminServerFunction } from "@quickben/admin";
import type { FieldInputContext } from "@quickben/admin/forms";
import type { Quickben, RequestContext } from "@quickben/core";
import type { CollectionMeta } from "@quickben/next";

/** Fields of `organizations` the settings page renders itself. */
export const ownOrganizationFields = new Set(["name", "slug", "status", "modules", "metadata"]);

/** Fields of `memberships` the members page renders itself. */
export const ownMembershipFields = new Set([
  "organization",
  "user",
  "email",
  "role",
  "status",
  "modules",
  "invitedBy",
  "invitedAt",
  "joinedAt",
  "memberKey",
]);

/**
 * The collection as the user sees it, limited to the fields a host or another plugin added
 * with `addFields`. Hidden and unreadable fields are left out. `null` when there are none.
 */
export async function addedFields(
  qb: Quickben,
  ctx: RequestContext,
  slug: string,
  own: ReadonlySet<string>,
  locale: string,
): Promise<CollectionMeta | null> {
  const collection = qb.collections[slug];
  if (!collection) return null;
  const meta = await collectionMeta(collection, ctx, { locale });
  if (!meta) return null;
  const fields = meta.fields.filter((field) => !own.has(field.name) && field.admin.hidden !== true);
  return fields.length === 0 ? null : { ...meta, fields };
}

/** The added fields of one form and what their inputs need. */
export interface AddedForm {
  collection: CollectionMeta;
  context: FieldInputContext;
}

/** Load the input context of the added fields for one document. */
export async function addedForm(
  qb: Quickben,
  ctx: RequestContext,
  collection: CollectionMeta,
  doc: Record<string, unknown>,
  options: Readonly<{ serverFunction: AdminServerFunction; i18n: AdminI18n; form: string }>,
): Promise<AddedForm> {
  const id = typeof doc.id === "string" ? doc.id : null;
  const context = await loadFieldContext({
    qb,
    ctx,
    collection,
    doc,
    serverFunction: options.serverFunction,
    scope: formScope(`${collection.slug}-${options.form}`, id),
    i18n: options.i18n,
  });
  return { collection, context };
}

/** Inputs of the added fields, with the generic admin inputs and field access. */
export function AddedFields({
  form,
  doc,
  readOnly,
}: Readonly<{
  form: AddedForm;
  doc: Record<string, unknown>;
  /** The user cannot change the document at all. */
  readOnly: boolean;
}>) {
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-x-5 qb:gap-y-5 qb:md:grid-cols-6">
      {form.collection.fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={doc[field.name] ?? null}
          context={{ ...form.context, readOnly: readOnly || !field.access.update }}
        />
      ))}
    </div>
  );
}
