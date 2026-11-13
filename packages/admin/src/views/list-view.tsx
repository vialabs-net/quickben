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
import { Button, ButtonLink } from "../ui/button";
import { Card } from "../ui/card";
import { Input, Label, Select } from "../ui/input";
import { Table, Td, Th, Tr } from "../ui/table";

import { PageHeader } from "./panels";

import type { Cell } from "../format";
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
}

function CellContent({ cell }: Readonly<{ cell: Cell }>) {
  switch (cell.kind) {
    case "empty":
      return <span className="qb:text-zinc-400">—</span>;
    case "boolean":
      return <Badge tone={cell.value ? "green" : "neutral"}>{cell.value ? "Yes" : "No"}</Badge>;
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
  const { collection, basePath, state } = props;
  const label = columnLabel(collection, column);
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
        className="qb:hover:text-zinc-900"
      >
        {label}
        {direction ? <span aria-hidden="true">{arrows[direction]}</span> : null}
      </Link>
    </Th>
  );
}

function FilterSelect({ field, value }: Readonly<{ field: FieldMeta; value: string | undefined }>) {
  const id = `qb-filter-${field.name}`;
  const options = field.type === "boolean" ? ["true", "false"] : (field.options ?? []);
  const optionLabel = (option: string) => {
    if (field.type !== "boolean") return option;
    return option === "true" ? "Yes" : "No";
  };
  return (
    <div className="qb:space-y-1">
      <Label htmlFor={id} className="qb:block qb:text-xs qb:text-zinc-500">
        {field.label}
      </Label>
      <Select
        id={id}
        name={`${filterPrefix}${field.name}`}
        defaultValue={value ?? ""}
        className="qb:w-40"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Toolbar(props: Readonly<ListViewProps>) {
  const { collection, basePath, state } = props;
  const search = searchField(collection);
  const filters = filterFields(collection);
  const active = state.q !== "" || Object.keys(state.filters).length > 0;
  if (!search && filters.length === 0) return null;
  return (
    <form
      method="get"
      action={`${basePath}/${collection.slug}`}
      role="search"
      className="qb:flex qb:flex-wrap qb:items-end qb:gap-3 qb:border-b qb:border-zinc-200 qb:px-4 qb:py-3"
    >
      {search ? (
        <div className="qb:min-w-56 qb:flex-1 qb:space-y-1 qb:lg:max-w-sm">
          <Label htmlFor="qb-search" className="qb:block qb:text-xs qb:text-zinc-500">
            Search {search.label.toLowerCase()}
          </Label>
          <Input
            id="qb-search"
            type="search"
            name="q"
            defaultValue={state.q}
            placeholder="Search…"
          />
        </div>
      ) : null}
      {filters.map((field) => (
        <FilterSelect key={field.name} field={field} value={state.filters[field.name]} />
      ))}
      {state.sort ? <input type="hidden" name="sort" value={state.sort} /> : null}
      {state.limit === 20 ? null : <input type="hidden" name="limit" value={state.limit} />}
      <div className="qb:flex qb:gap-2">
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {active ? (
          <ButtonLink
            href={listHref(basePath, collection.slug, state, { q: "", filters: {}, page: 1 })}
            variant="ghost"
          >
            Clear
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}

function Pagination(props: Readonly<ListViewProps>) {
  const { collection, basePath, state, result } = props;
  const total = result.totalDocs ?? 0;
  const from = total === 0 ? 0 : (state.page - 1) * state.limit + 1;
  const to = Math.min(state.page * state.limit, total);
  const pages = result.totalPages ?? 1;
  const linkClass = "qb:rounded-md qb:px-2.5 qb:py-1 qb:hover:bg-zinc-100";
  return (
    <nav
      aria-label="Pagination"
      className="qb:flex qb:flex-wrap qb:items-center qb:justify-between qb:gap-3 qb:px-4 qb:py-3 qb:text-sm qb:text-zinc-600"
    >
      <p>
        {total === 0 ? "No results" : `Showing ${String(from)}–${String(to)} of ${String(total)}`}
      </p>
      <div className="qb:flex qb:items-center qb:gap-1">
        <span className="qb:mr-2 qb:text-zinc-500">Per page:</span>
        {pageSizes.map((size) => (
          <Link
            key={size}
            href={listHref(basePath, collection.slug, state, { limit: size, page: 1 })}
            aria-current={size === state.limit ? "true" : undefined}
            className={
              size === state.limit
                ? `${linkClass} qb:bg-zinc-100 qb:font-medium qb:text-zinc-900`
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
            ← Previous
          </Link>
        ) : null}
        <span>
          Page {state.page} of {Math.max(pages, 1)}
        </span>
        {result.hasNextPage ? (
          <Link
            href={listHref(basePath, collection.slug, state, { page: state.page + 1 })}
            className={linkClass}
            rel="next"
          >
            Next →
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Table of documents with search, filters, sorting and pagination. */
export function ListView(props: Readonly<ListViewProps>) {
  const { collection, basePath, result, metas } = props;
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
              New {collection.labels.singular.toLowerCase()}
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
                        className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
                      >
                        {formatCell(collection, column, doc, metas).kind === "empty" ? (
                          documentTitle(collection, doc)
                        ) : (
                          <CellContent cell={formatCell(collection, column, doc, metas)} />
                        )}
                      </Link>
                    ) : (
                      <CellContent cell={formatCell(collection, column, doc, metas)} />
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
            {result.docs.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-zinc-500"
                >
                  No {collection.labels.plural.toLowerCase()} found.
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
