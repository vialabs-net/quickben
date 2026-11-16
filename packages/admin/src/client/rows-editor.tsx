"use client";

import { useEffect, useRef, useState } from "react";

import { useAdminI18n } from "../i18n/context";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Checkbox, Input, Select } from "../ui/input";
import { Table, Td, Th } from "../ui/table";

import { useFieldErrors } from "./document-form";
import { JsonEditor } from "./json-editor";

import type { JsonRowColumn } from "@quickben/core";

/** Props of {@link RowsEditor}. */
export interface RowsEditorProps {
  /** Id of the editor. Cell ids derive from it, see `cellId`. */
  id: string;
  /** Form control name. The value is submitted as JSON text, like a JSON editor. */
  name: string;
  /** Columns, from `FieldMeta.rows` or `jsonRowColumns`. */
  columns: readonly JsonRowColumn[];
  /** Current value: a list of objects. Any other value opens the JSON editor. */
  defaultValue: unknown;
  required: boolean;
  disabled: boolean;
  /** Ids of the hint and error elements of the field. */
  describedBy: string;
  /** Id of the element that names the editor. Default `<id>-label`. */
  labelledBy?: string;
  /**
   * Errors per cell, keyed `<row>.<key>` (`0.id`). Default: the errors of the enclosing admin
   * document form under `<errorKey>.<row>.<key>`.
   */
  errors?: Readonly<Record<string, string>>;
  /** Field name of the form errors. Default `name`. */
  errorKey?: string;
  /** Id of the input of a cell. Default `<id>.<row>.<key>`, matching the admin control ids. */
  cellId?: (row: number, key: string) => string;
}

interface Row {
  uid: number;
  /** Text of each cell input. Checkboxes are `"true"` or `""`. */
  cells: Record<string, string>;
  /** Properties without a column, kept as they are. */
  rest: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as rows, or `null` when it is not a list of objects. */
function asObjects(value: unknown): Record<string, unknown>[] | null {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) && value.every(isPlainObject) ? value : null;
}

function cellOf(column: JsonRowColumn, value: unknown): string {
  const current = value === undefined ? column.default : value;
  if (column.type === "boolean") return current === true ? "true" : "";
  return typeof current === "string" || typeof current === "number" ? String(current) : "";
}

/** JSON text as rows, or `null` when it is invalid or not a list of objects. */
function parseObjects(text: string): Record<string, unknown>[] | null {
  if (text.trim() === "") return [];
  try {
    return asObjects(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

let nextUid = 0;

function toRow(columns: readonly JsonRowColumn[], object: Record<string, unknown>): Row {
  const keys = new Set(columns.map((column) => column.key));
  nextUid += 1;
  return {
    uid: nextUid,
    cells: Object.fromEntries(
      columns.map((column) => [column.key, cellOf(column, object[column.key])]),
    ),
    rest: Object.fromEntries(Object.entries(object).filter(([key]) => !keys.has(key))),
  };
}

/**
 * The object of a row. Empty optional cells are left out, so schema defaults apply. Numbers
 * that do not parse stay text, so the schema reports them.
 */
function toObject(columns: readonly JsonRowColumn[], row: Row): Record<string, unknown> {
  const object: Record<string, unknown> = { ...row.rest };
  for (const column of columns) {
    const cell = row.cells[column.key];
    if (column.type === "boolean") {
      object[column.key] = cell === "true";
      continue;
    }
    if (cell === undefined || (cell === "" && !column.required)) continue;
    if (column.type === "number" && cell !== "") {
      const number = Number(cell);
      object[column.key] = Number.isFinite(number) ? number : cell;
    } else {
      object[column.key] = cell;
    }
  }
  return object;
}

function serialize(columns: readonly JsonRowColumn[], rows: readonly Row[], empty: string): string {
  return rows.length === 0 ? empty : JSON.stringify(rows.map((row) => toObject(columns, row)));
}

function CellInput({
  column,
  value,
  id,
  label,
  error,
  disabled,
  onChange,
}: Readonly<{
  column: JsonRowColumn;
  value: string;
  id: string;
  label: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}>) {
  const shared = {
    id,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    disabled,
  };
  switch (column.type) {
    case "boolean":
      return (
        <Checkbox
          {...shared}
          checked={value === "true"}
          onChange={(event) => {
            onChange(event.currentTarget.checked ? "true" : "");
          }}
        />
      );
    case "select":
      return (
        <Select
          {...shared}
          value={value}
          required={column.required}
          className="qb:min-w-32"
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        >
          <option value="">—</option>
          {(column.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "number":
      return (
        <Input
          {...shared}
          type="number"
          inputMode={column.integer ? "numeric" : "decimal"}
          step={column.integer ? 1 : "any"}
          min={column.min}
          max={column.max}
          required={column.required}
          value={value}
          className="qb:w-28"
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      );
    default:
      return (
        <Input
          {...shared}
          type="text"
          minLength={column.minLength}
          maxLength={column.maxLength}
          required={column.required}
          value={value}
          className="qb:min-w-40"
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      );
  }
}

/**
 * Editor for a JSON list of objects with primitive properties: one row per object and one
 * input per property, with add, remove and reorder. Raw JSON stays available with a toggle.
 * The admin uses it for `json` fields with `FieldMeta.rows`.
 */
export function RowsEditor({
  id,
  name,
  columns,
  defaultValue,
  required,
  disabled,
  describedBy,
  labelledBy = `${id}-label`,
  errors,
  errorKey = name,
  cellId = (row, key) => `${id}.${String(row)}.${key}`,
}: Readonly<RowsEditorProps>) {
  const i18n = useAdminI18n();
  const formErrors = useFieldErrors();
  const initial = asObjects(defaultValue);
  const empty = defaultValue === null || defaultValue === undefined ? "" : "[]";
  const [rows, setRows] = useState<Row[]>(() => (initial ?? []).map((o) => toRow(columns, o)));
  const [mode, setMode] = useState<"rows" | "json">(initial === null ? "json" : "rows");
  const [jsonText, setJsonText] = useState(() =>
    initial === null ? JSON.stringify(defaultValue, null, 2) : "",
  );
  const [jsonProblem, setJsonProblem] = useState(false);
  // Errors belong to the rows as submitted. Adding, removing or moving rows hides them.
  const [staleErrors, setStaleErrors] = useState<object | null>(null);
  const focusNext = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) rootRef.current?.ownerDocument.getElementById(target)?.focus();
  });

  const source = errors ?? formErrors;
  const cellError = (row: number, key: string): string | undefined => {
    if (staleErrors === source) return undefined;
    return errors
      ? errors[`${String(row)}.${key}`]
      : formErrors[`${errorKey}.${String(row)}.${key}`];
  };

  const restructure = (next: Row[]) => {
    setStaleErrors(source);
    setRows(next);
  };
  const update = (uid: number, key: string, value: string) => {
    setRows((current) =>
      current.map((row) =>
        row.uid === uid ? { ...row, cells: { ...row.cells, [key]: value } } : row,
      ),
    );
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + by, 0, row);
    // Keep focus on the moved row: the same button, or the other one at the ends.
    const to = index + by;
    const atEnd = by < 0 ? to === 0 : to === next.length - 1;
    const button = (by < 0) !== atEnd ? "up" : "down";
    focusNext.current = `${id}-${button}-${String(to)}`;
    restructure(next);
  };
  const add = () => {
    const first = columns[0];
    if (first) focusNext.current = cellId(rows.length, first.key);
    restructure([...rows, toRow(columns, {})]);
  };
  const remove = (index: number) => {
    focusNext.current = `${id}-add`;
    restructure(rows.filter((_, i) => i !== index));
  };

  const toJson = () => {
    setJsonText(
      rows.length === 0
        ? ""
        : JSON.stringify(
            rows.map((row) => toObject(columns, row)),
            null,
            2,
          ),
    );
    setJsonProblem(false);
    setMode("json");
  };
  const toRows = () => {
    const text = rootRef.current?.querySelector("textarea")?.value ?? jsonText;
    const objects = parseObjects(text);
    if (objects === null) {
      setJsonText(text);
      setJsonProblem(true);
      return;
    }
    setJsonProblem(false);
    restructure(objects.map((object) => toRow(columns, object)));
    setMode("rows");
  };

  const toggle = (
    <Button
      size="sm"
      variant="ghost"
      onClick={mode === "rows" ? toJson : toRows}
      aria-pressed={mode === "json"}
    >
      {i18n.t("rows.json")}
    </Button>
  );

  if (mode === "json") {
    return (
      <div ref={rootRef} className="qb:space-y-2">
        <JsonEditor
          key={jsonText}
          id={id}
          name={name}
          defaultValue={jsonText}
          required={required}
          disabled={disabled}
          describedBy={jsonProblem ? `${describedBy} ${id}-rows` : describedBy}
        />
        <div className="qb:flex qb:flex-wrap qb:items-center qb:justify-between qb:gap-3">
          <p
            id={`${id}-rows`}
            aria-live="polite"
            className={jsonProblem ? "qb:text-xs qb:text-danger" : "qb:sr-only"}
          >
            {jsonProblem ? i18n.t("rows.notRows") : null}
          </p>
          {toggle}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      id={id}
      tabIndex={-1}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="qb:space-y-2 qb:outline-none"
    >
      <input type="hidden" name={name} value={serialize(columns, rows, empty)} />
      <div className="qb:rounded-md qb:border qb:border-line">
        <Table>
          <thead>
            <tr>
              <Th scope="col" className="qb:w-10 qb:px-3">
                <span className="qb:sr-only">{i18n.t("rows.number")}</span>
              </Th>
              {columns.map((column) => (
                <Th
                  key={column.key}
                  scope="col"
                  className="qb:px-3"
                  title={column.description ?? undefined}
                >
                  {column.label}
                  {column.required ? (
                    <span className="qb:text-danger" aria-hidden="true">
                      {" "}
                      *
                    </span>
                  ) : null}
                </Th>
              ))}
              {disabled ? null : (
                <Th scope="col" className="qb:px-3">
                  <span className="qb:sr-only">{i18n.t("rows.actions")}</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const number = index + 1;
              return (
                <tr key={row.uid}>
                  <Td className="qb:px-3 qb:text-fg-muted qb:tabular-nums">{number}</Td>
                  {columns.map((column) => {
                    const cell = cellId(index, column.key);
                    const error = cellError(index, column.key);
                    return (
                      <Td
                        key={column.key}
                        className={cn(
                          "qb:px-3 qb:align-top",
                          column.type === "boolean" && "qb:text-center",
                        )}
                      >
                        <CellInput
                          column={column}
                          value={row.cells[column.key] ?? ""}
                          id={cell}
                          label={i18n.t("rows.cell", { column: column.label, row: number })}
                          error={error}
                          disabled={disabled}
                          onChange={(value) => {
                            update(row.uid, column.key, value);
                          }}
                        />
                        {error ? (
                          <p
                            id={`${cell}-error`}
                            className="qb:mt-1 qb:max-w-60 qb:text-xs qb:text-danger"
                          >
                            {error}
                          </p>
                        ) : null}
                      </Td>
                    );
                  })}
                  {disabled ? null : (
                    <Td className="qb:px-3 qb:align-top">
                      <div className="qb:flex qb:gap-1">
                        <Button
                          id={`${id}-up-${String(index)}`}
                          size="sm"
                          variant="ghost"
                          aria-label={i18n.t("rows.up", { row: number })}
                          disabled={index === 0}
                          onClick={() => {
                            move(index, -1);
                          }}
                        >
                          <span aria-hidden="true">↑</span>
                        </Button>
                        <Button
                          id={`${id}-down-${String(index)}`}
                          size="sm"
                          variant="ghost"
                          aria-label={i18n.t("rows.down", { row: number })}
                          disabled={index === rows.length - 1}
                          onClick={() => {
                            move(index, 1);
                          }}
                        >
                          <span aria-hidden="true">↓</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={i18n.t("rows.remove", { row: number })}
                          onClick={() => {
                            remove(index);
                          }}
                        >
                          <span aria-hidden="true">×</span>
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (disabled ? 1 : 2)}
                  className="qb:px-3 qb:py-4 qb:text-sm qb:text-fg-muted"
                >
                  {i18n.t("rows.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </div>
      <div className="qb:flex qb:flex-wrap qb:items-center qb:justify-between qb:gap-3">
        {disabled ? (
          <span />
        ) : (
          <Button id={`${id}-add`} size="sm" variant="secondary" onClick={add}>
            {i18n.t("rows.add")}
          </Button>
        )}
        {toggle}
      </div>
    </div>
  );
}
