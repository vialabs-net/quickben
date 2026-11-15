import { DeleteButton } from "../client/delete-button";
import { DocumentForm } from "../client/document-form";
import { documentTitle } from "../format";
import { formScope } from "../ids";
import { Badge } from "../ui/badge";
import { ButtonLink } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";

import { FieldInput } from "./field-input";
import { PageHeader } from "./panels";

import type { AdminI18n } from "../i18n/translator";
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
  context: Omit<FieldInputContext, "readOnly" | "serverFunction" | "scope" | "i18n">;
  i18n: AdminI18n;
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
  i18n,
}: Readonly<EditViewProps>) {
  const singular = i18n.lower(collection.labels.singular);
  const listHref = `${basePath}/${collection.slug}`;
  const id = doc ? String(doc.id) : null;
  const scope = formScope(collection.slug, id);
  const creating = doc === null;
  const readOnly = creating ? !collection.access.create : !collection.access.update;
  const title = creating ? i18n.t("edit.new", { singular }) : documentTitle(collection, doc);
  return (
    <>
      <PageHeader
        title={title}
        crumbs={[
          { label: collection.labels.plural, href: listHref },
          { label: creating ? i18n.t("edit.crumbNew") : i18n.t("edit.crumbEdit") },
        ]}
        actions={readOnly ? <Badge>{i18n.t("edit.readOnly")}</Badge> : null}
        i18n={i18n}
      />
      <div className="qb:grid qb:items-start qb:gap-6 qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
        <Card>
          <DocumentForm
            serverFunction={serverFunction}
            basePath={basePath}
            slug={collection.slug}
            id={id}
            submitLabel={creating ? i18n.t("edit.create", { singular }) : i18n.t("edit.save")}
            readOnly={readOnly}
            secondary={
              <ButtonLink href={listHref} variant="ghost">
                {i18n.t("edit.cancel")}
              </ButtonLink>
            }
          >
            <div className="qb:grid qb:grid-cols-1 qb:gap-x-5 qb:gap-y-5 qb:md:grid-cols-6">
              {collection.fields.map((field) => (
                <FieldInput
                  key={field.name}
                  field={field}
                  value={doc ? doc[field.name] : initialValue(field)}
                  context={{
                    ...context,
                    serverFunction,
                    readOnly: readOnly || !field.access[creating ? "create" : "update"],
                    scope,
                    i18n,
                  }}
                />
              ))}
            </div>
          </DocumentForm>
        </Card>
        {doc ? (
          <Card>
            <CardHeader title={i18n.t("edit.details")} />
            <CardBody className="qb:space-y-4">
              <dl className="qb:space-y-3 qb:text-sm">
                <div>
                  <dt className="qb:text-fg-muted">{i18n.t("column.id")}</dt>
                  <dd className="qb:font-mono qb:text-xs qb:break-all qb:text-fg">
                    {String(doc.id)}
                  </dd>
                </div>
                <div>
                  <dt className="qb:text-fg-muted">{i18n.t("column.createdAt")}</dt>
                  <dd className="qb:text-fg">{i18n.dateTime(String(doc.createdAt))}</dd>
                </div>
                <div>
                  <dt className="qb:text-fg-muted">{i18n.t("column.updatedAt")}</dt>
                  <dd className="qb:text-fg">{i18n.dateTime(String(doc.updatedAt))}</dd>
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
