import { DeleteButton } from "../client/delete-button";
import { DocumentForm } from "../client/document-form";
import { documentTitle, formatDatetime } from "../format";
import { formScope } from "../ids";
import { Badge } from "../ui/badge";
import { ButtonLink } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";

import { FieldInput } from "./field-input";
import { PageHeader } from "./panels";

import type { AdminServerFunction } from "../types";
import type { FieldInputContext } from "./field-input";
import type { CollectionMeta } from "@quickben/next";

/** Props of {@link EditView}. */
export interface EditViewProps {
  collection: CollectionMeta;
  basePath: string;
  /** The stored document, or `null` on create. */
  doc: Record<string, unknown> | null;
  serverFunction: AdminServerFunction;
  context: Omit<FieldInputContext, "readOnly" | "serverFunction" | "scope">;
}

function initialValue(field: CollectionMeta["fields"][number]): unknown {
  if (field.default !== undefined) return field.default;
  return field.many ? [] : null;
}

/** Create or edit form of a document, with its details and delete button. */
export function EditView({
  collection,
  basePath,
  doc,
  serverFunction,
  context,
}: Readonly<EditViewProps>) {
  const listHref = `${basePath}/${collection.slug}`;
  const id = doc ? String(doc.id) : null;
  const scope = formScope(collection.slug, id);
  const creating = doc === null;
  const readOnly = creating ? !collection.access.create : !collection.access.update;
  const title = creating
    ? `New ${collection.labels.singular.toLowerCase()}`
    : documentTitle(collection, doc);
  return (
    <>
      <PageHeader
        title={title}
        crumbs={[
          { label: collection.labels.plural, href: listHref },
          { label: creating ? "New" : "Edit" },
        ]}
        actions={readOnly ? <Badge>Read only</Badge> : null}
      />
      <div className="qb:grid qb:items-start qb:gap-6 qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
        <Card>
          <DocumentForm
            serverFunction={serverFunction}
            basePath={basePath}
            slug={collection.slug}
            id={id}
            submitLabel={
              creating ? `Create ${collection.labels.singular.toLowerCase()}` : "Save changes"
            }
            readOnly={readOnly}
            secondary={
              <ButtonLink href={listHref} variant="ghost">
                Cancel
              </ButtonLink>
            }
          >
            <div className="qb:grid qb:grid-cols-1 qb:gap-x-5 qb:gap-y-5 qb:md:grid-cols-6">
              {collection.fields.map((field) => (
                <FieldInput
                  key={field.name}
                  field={field}
                  value={doc ? doc[field.name] : initialValue(field)}
                  context={{ ...context, serverFunction, readOnly, scope }}
                />
              ))}
            </div>
          </DocumentForm>
        </Card>
        {doc ? (
          <Card>
            <CardHeader title="Details" />
            <CardBody className="qb:space-y-4">
              <dl className="qb:space-y-3 qb:text-sm">
                <div>
                  <dt className="qb:text-zinc-500">ID</dt>
                  <dd className="qb:font-mono qb:text-xs qb:break-all qb:text-zinc-900">
                    {String(doc.id)}
                  </dd>
                </div>
                <div>
                  <dt className="qb:text-zinc-500">Created</dt>
                  <dd className="qb:text-zinc-900">{formatDatetime(String(doc.createdAt))}</dd>
                </div>
                <div>
                  <dt className="qb:text-zinc-500">Updated</dt>
                  <dd className="qb:text-zinc-900">{formatDatetime(String(doc.updatedAt))}</dd>
                </div>
              </dl>
              {collection.access.delete ? (
                <DeleteButton
                  serverFunction={serverFunction}
                  basePath={basePath}
                  slug={collection.slug}
                  id={String(doc.id)}
                  label={collection.labels.singular}
                  title={title}
                />
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
