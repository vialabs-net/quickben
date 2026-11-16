import Link from "next/link";

import { columnLabel, documentTitle, formatCell } from "../format";
import {
  columnsOf,
  filterFields,
  filterPrefix,
  isSortable,
  listHref,
  nextSort,
  pageSizes,
  searchField,
} from "../list-query";
import { Badge } from "../ui/badge";
import { ButtonLink } from "../ui/button";
import { Card } from "../ui/card";
import { ListToolbar } from "../ui/list-toolbar";
import { Table, Td, Th, Tr } from "../ui/table";

import { PageHeader } from "./panels";

import type { Cell } from "../format";
import type { AdminI18n } from "../i18n/translator";
import type { ListState } from "../list-query";
import type { FindResult } from "@quickben/core";
import type { CollectionMeta, FieldMeta } from "@quickben/next";

/** Props of {@link ListView}. */
export interface ListViewProps {
  collection: CollectionMeta;
  basePath: string;
  state: ListState;
  result: FindResult<Record<string, unknown>>;
  /** Every readable collection, to show titles of related documents. */
  metas: ReadonlyMap<string, CollectionMeta>;
  i18n: AdminI18n;
}

function CellContent({ cell, i18n }: Readonly<{ cell: Cell; i18n: AdminI18n }>) {
  switch (cell.kind) {
    case "empty":
      return <span className="qb:text-fg-subtle">{i18n.t("value.empty")}</span>;
    case "boolean":
      return (
        <Badge tone={cell.value ? "green" : "neutral"}>
          {cell.value ? i18n.t("value.yes") : i18n.t("value.no")}
        </Badge>
      );
    case "badges":
      return (
        <span className="qb:flex qb:flex-wrap qb:gap-1">
          {cell.items.map((item) => (
            <Badge key={item} tone="blue">
              {item}
            </Badge>
          ))}
        </span>
      );
    case "text":
      return <span className={cell.mono ? "qb:font-mono qb:text-xs" : undefined}>{cell.text}</span>;
  }
}

function SortHeader({ props, column }: Readonly<{ props: ListViewProps; column: string }>) {
  const { collection, basePath, state, i18n } = props;
  const label = columnLabel(collection, column, i18n);
  if (!isSortable(collection, column)) return <Th scope="col">{label}</Th>;
  let direction: "ascending" | "descending" | undefined;
  if (state.sort === column) direction = "ascending";
  else if (state.sort === `-${column}`) direction = "descending";
  const arrows = { ascending: " ↑", descending: " ↓" } as const;
  return (
    <Th scope="col" aria-sort={direction ?? "none"}>
      <Link
        href={listHref(basePath, collection.slug, state, {
          sort: nextSort(state, column),
          page: 1,
        })}
        className="qb:hover:text-fg"
      >
        {label}
        {direction ? <span aria-hidden="true">{arrows[direction]}</span> : null}
      </Link>
    </Th>
  );
}

function Toolbar(props: Readonly<ListViewProps>) {
  const { collection, basePath, state, i18n } = props;
  const search = searchField(collection);
  const optionLabel = (field: FieldMeta, option: string) => {
    if (field.type !== "boolean") return option;
    return option === "true" ? i18n.t("value.yes") : i18n.t("value.no");
  };
  const hidden: Record<string, string> = {};
  if (state.sort) hidden.sort = state.sort;
  if (state.limit !== 20) hidden.limit = String(state.limit);
  return (
    <ListToolbar
      action={`${basePath}/${collection.slug}`}
      // Per collection: Next.js can keep the lists of other collections mounted but hidden.
      idPrefix={`qb-${collection.slug}`}
      search={
        search
          ? { label: i18n.t("list.search", { field: i18n.lower(search.label) }), value: state.q }
          : null
      }
      filters={filterFields(collection).map((field) => ({
        name: `${filterPrefix}${field.name}`,
        label: field.label,
        value: state.filters[field.name] ?? "",
        options: (field.type === "boolean" ? ["true", "false"] : (field.options ?? [])).map(
          (option) => ({ value: option, label: optionLabel(field, option) }),
        ),
      }))}
      hidden={hidden}
      clearHref={listHref(basePath, collection.slug, state, { q: "", filters: {}, page: 1 })}
      i18n={i18n}
    />
  );
}

function Pagination(props: Readonly<ListViewProps>) {
  const { collection, basePath, state, result, i18n } = props;
  const total = result.totalDocs ?? 0;
  const from = total === 0 ? 0 : (state.page - 1) * state.limit + 1;
  const to = Math.min(state.page * state.limit, total);
  const pages = result.totalPages ?? 1;
  const linkClass = "qb:rounded-md qb:px-2.5 qb:py-1 qb:hover:bg-surface-strong";
  return (
    <nav
      aria-label={i18n.t("list.pagination")}
      className="qb:flex qb:flex-wrap qb:items-center qb:justify-between qb:gap-3 qb:px-4 qb:py-3 qb:text-sm qb:text-fg-muted"
    >
      <p>{total === 0 ? i18n.t("list.noResults") : i18n.t("list.showing", { from, to, total })}</p>
      <div className="qb:flex qb:items-center qb:gap-1">
        <span className="qb:mr-2 qb:text-fg-muted">{i18n.t("list.perPage")}</span>
        {pageSizes.map((size) => (
          <Link
            key={size}
            href={listHref(basePath, collection.slug, state, { limit: size, page: 1 })}
            aria-current={size === state.limit ? "true" : undefined}
            className={
              size === state.limit
                ? `${linkClass} qb:bg-surface-strong qb:font-medium qb:text-fg`
                : linkClass
            }
          >
            {size}
          </Link>
        ))}
      </div>
      <div className="qb:flex qb:items-center qb:gap-2">
        {state.page > 1 ? (
          <Link
            href={listHref(basePath, collection.slug, state, { page: state.page - 1 })}
            className={linkClass}
            rel="prev"
          >
            {i18n.t("list.previous")}
          </Link>
        ) : null}
        <span>{i18n.t("list.page", { page: state.page, pages: Math.max(pages, 1) })}</span>
        {result.hasNextPage ? (
          <Link
            href={listHref(basePath, collection.slug, state, { page: state.page + 1 })}
            className={linkClass}
            rel="next"
          >
            {i18n.t("list.next")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Table of documents with search, filters, sorting and pagination. */
export function ListView(props: Readonly<ListViewProps>) {
  const { collection, basePath, result, metas, i18n } = props;
  const columns = columnsOf(collection);
  const editHref = (doc: Record<string, unknown>) =>
    `${basePath}/${collection.slug}/${encodeURIComponent(String(doc.id))}`;
  return (
    <>
      <PageHeader
        title={collection.labels.plural}
        description={collection.admin.description}
        actions={
          collection.access.create ? (
            <ButtonLink href={`${basePath}/${collection.slug}/new`}>
              {i18n.t("list.new", { singular: i18n.lower(collection.labels.singular) })}
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <Toolbar {...props} />
        <Table>
          <thead>
            <tr>
              {columns.map((column) => (
                <SortHeader key={column} props={props} column={column} />
              ))}
            </tr>
          </thead>
          <tbody>
            {result.docs.map((doc) => (
              <Tr key={String(doc.id)}>
                {columns.map((column, index) => (
                  <Td key={column}>
                    {index === 0 ? (
                      <Link
                        href={editHref(doc)}
                        className="qb:font-medium qb:text-fg qb:hover:underline"
                      >
                        {formatCell(collection, column, doc, metas, i18n).kind === "empty" ? (
                          documentTitle(collection, doc)
                        ) : (
                          <CellContent
                            cell={formatCell(collection, column, doc, metas, i18n)}
                            i18n={i18n}
                          />
                        )}
                      </Link>
                    ) : (
                      <CellContent
                        cell={formatCell(collection, column, doc, metas, i18n)}
                        i18n={i18n}
                      />
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
            {result.docs.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-fg-muted"
                >
                  {i18n.t("list.empty", { plural: i18n.lower(collection.labels.plural) })}
                </td>
              </tr>
            ) : null}
          </tbody>
        </Table>
        <Pagination {...props} />
      </Card>
    </>
  );
}
