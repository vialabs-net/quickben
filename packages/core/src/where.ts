import { ValidationError } from "./errors";

import type { DocumentData, SortSpec, WhereNode, WhereOperator } from "./adapter";
import type { AnyField } from "./fields";
import type { SanitizedCollection } from "./types";

const operators = new Set<string>([
  "eq",
  "ne",
  "in",
  "notIn",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "exists",
]);

const allowedByKind: Record<string, ReadonlySet<WhereOperator>> = {
  text: new Set([
    "eq",
    "ne",
    "in",
    "notIn",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "exists",
  ]),
  range: new Set(["eq", "ne", "in", "notIn", "lt", "lte", "gt", "gte", "exists"]),
  equality: new Set(["eq", "ne", "in", "notIn", "exists"]),
  array: new Set(["contains", "in", "notIn", "exists"]),
  json: new Set(["exists"]),
};

type ValueKind = "string" | "number" | "boolean" | "date" | "datetime";

interface FieldRule {
  kind: keyof typeof allowedByKind;
  value: ValueKind;
  options?: readonly string[];
}

const systemRules: Record<string, FieldRule> = {
  id: { kind: "equality", value: "string" },
  createdAt: { kind: "range", value: "datetime" },
  updatedAt: { kind: "range", value: "datetime" },
};

function ruleFor(field: AnyField): FieldRule {
  const options = field.type === "select" ? field.options : undefined;
  const value = valueKindOf(field);
  if (field.many) return { kind: "array", value, ...(options ? { options } : {}) };
  switch (field.type) {
    case "number":
    case "date":
    case "datetime":
      return { kind: "range", value };
    case "boolean":
    case "relation":
      return { kind: "equality", value };
    case "select":
      return { kind: "equality", value, ...(options ? { options } : {}) };
    case "json":
      return { kind: "json", value };
    default:
      return { kind: "text", value };
  }
}

function valueKindOf(field: AnyField): ValueKind {
  switch (field.type) {
    case "number":
    case "boolean":
      return field.type;
    case "date":
    case "datetime":
      return field.type;
    default:
      return "string";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a user `where` against a collection and convert it to a {@link WhereNode}.
 * Dates become ISO strings. Throws `ValidationError` on unknown fields, operators or values.
 */
export function normalizeWhere(collection: SanitizedCollection, where: unknown): WhereNode {
  return normalizeGroup(collection, where, "where");
}

function normalizeGroup(collection: SanitizedCollection, where: unknown, path: string): WhereNode {
  if (where === undefined || where === null) return { and: [] };
  if (!isPlainObject(where)) throw invalid(path, "Expected an object");
  const nodes: WhereNode[] = [];
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "and" || key === "or") {
      if (!Array.isArray(condition)) throw invalid(`${path}.${key}`, "Expected an array");
      const children = condition.map((child: unknown, index) =>
        normalizeGroup(collection, child, `${path}.${key}.${index}`),
      );
      nodes.push(key === "and" ? { and: children } : { or: children });
      continue;
    }
    nodes.push(...normalizeCondition(collection, key, condition, `${path}.${key}`));
  }
  return nodes.length === 1 && nodes[0] ? nodes[0] : { and: nodes };
}

function fieldRule(collection: SanitizedCollection, field: string): FieldRule | undefined {
  if (Object.hasOwn(collection.fields, field)) {
    const definition = collection.fields[field];
    return definition ? ruleFor(definition) : undefined;
  }
  return Object.hasOwn(systemRules, field) ? systemRules[field] : undefined;
}

function normalizeCondition(
  collection: SanitizedCollection,
  field: string,
  condition: unknown,
  path: string,
): WhereNode[] {
  const rule = fieldRule(collection, field);
  if (!rule) throw invalid(path, `Unknown field "${field}" in collection "${collection.slug}"`);
  if (!isPlainObject(condition)) throw invalid(path, "Expected an object of operators");
  const allowed = allowedByKind[rule.kind];
  const nodes: WhereNode[] = [];
  for (const [op, raw] of Object.entries(condition)) {
    if (raw === undefined) continue;
    if (!operators.has(op)) throw invalid(`${path}.${op}`, `Unknown operator "${op}"`);
    if (!allowed?.has(op as WhereOperator)) {
      throw invalid(`${path}.${op}`, `Operator "${op}" is not allowed on field "${field}"`);
    }
    nodes.push({
      field,
      op: op as WhereOperator,
      value: normalizeOperand(rule, op, raw, `${path}.${op}`),
    });
  }
  return nodes;
}

function normalizeOperand(rule: FieldRule, op: string, raw: unknown, path: string): unknown {
  if (op === "exists") {
    if (typeof raw !== "boolean") throw invalid(path, "Expected a boolean");
    return raw;
  }
  if (op === "contains" || op === "startsWith") {
    if (rule.kind === "array") return normalizeScalar(rule, raw, path);
    if (typeof raw !== "string") throw invalid(path, "Expected a string");
    return raw;
  }
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(raw)) throw invalid(path, "Expected an array");
    return raw.map((item: unknown, index) => normalizeScalar(rule, item, `${path}.${index}`));
  }
  return normalizeScalar(rule, raw, path);
}

function normalizeScalar(rule: FieldRule, raw: unknown, path: string): unknown {
  switch (rule.value) {
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw))
        throw invalid(path, "Expected a number");
      return raw;
    case "boolean":
      if (typeof raw !== "boolean") throw invalid(path, "Expected a boolean");
      return raw;
    case "date":
    case "datetime":
      return normalizeDateOperand(rule.value, raw, path);
    default:
      if (typeof raw !== "string") throw invalid(path, "Expected a string");
      if (rule.options && !rule.options.includes(raw)) {
        throw invalid(path, `Expected one of: ${rule.options.join(", ")}`);
      }
      return raw;
  }
}

function normalizeDateOperand(kind: "date" | "datetime", raw: unknown, path: string): string {
  if (!(raw instanceof Date) && typeof raw !== "string") throw invalid(path, "Expected a date");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw invalid(path, "Expected a date");
  const iso = date.toISOString();
  return kind === "date" ? iso.slice(0, 10) : iso;
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError([{ path, message }]);
}

/** Combine filters with AND, dropping empty ones. */
export function andWhere(...nodes: (WhereNode | undefined)[]): WhereNode {
  const parts = nodes.filter((node): node is WhereNode => node !== undefined && !isMatchAll(node));
  if (parts.length === 1 && parts[0]) return parts[0];
  return { and: parts };
}

function isMatchAll(node: WhereNode): boolean {
  return "and" in node && node.and.length === 0;
}

/**
 * Evaluate a normalized filter against a plain document. This is the reference behavior of
 * the query model: every adapter must return the same documents.
 */
export function matchesWhere(doc: DocumentData, where: WhereNode | undefined): boolean {
  if (!where) return true;
  if ("and" in where) return where.and.every((node) => matchesWhere(doc, node));
  if ("or" in where) return where.or.some((node) => matchesWhere(doc, node));
  const value = doc[where.field] ?? null;
  return Array.isArray(value)
    ? matchesArray(value, where.op, where.value)
    : matchesScalar(value, where.op, where.value);
}

function matchesArray(values: unknown[], op: WhereOperator, operand: unknown): boolean {
  switch (op) {
    case "contains":
      return values.includes(operand);
    case "in":
      return values.some((value) => (operand as unknown[]).includes(value));
    case "notIn":
      return !values.some((value) => (operand as unknown[]).includes(value));
    case "exists":
      return values.length > 0 === operand;
    default:
      return false;
  }
}

function matchesScalar(value: unknown, op: WhereOperator, operand: unknown): boolean {
  switch (op) {
    case "exists":
      return (value !== null) === operand;
    case "ne":
      return value === null || value !== operand;
    case "notIn":
      return value === null || !(operand as unknown[]).includes(value);
    default:
      return value !== null && matchesPresent(value, op, operand);
  }
}

function matchesPresent(value: unknown, op: WhereOperator, operand: unknown): boolean {
  switch (op) {
    case "eq":
      return value === operand;
    case "in":
      return (operand as unknown[]).includes(value);
    case "lt":
      return compareValues(value, operand) < 0;
    case "lte":
      return compareValues(value, operand) <= 0;
    case "gt":
      return compareValues(value, operand) > 0;
    case "gte":
      return compareValues(value, operand) >= 0;
    case "contains":
      return lower(value).includes(lower(operand));
    case "startsWith":
      return lower(value).startsWith(lower(operand));
    default:
      return false;
  }
}

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * Compare two values of the same field. Numbers compare numerically, booleans as
 * `false < true`, strings by UTF-16 code units. `null` is greater than any value.
 */
export function compareValues(a: unknown, b: unknown): number {
  const left = a ?? null;
  const right = b ?? null;
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return left ? 1 : -1;
  const l = typeof left === "string" ? left : JSON.stringify(left);
  const r = typeof right === "string" ? right : JSON.stringify(right);
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

/** Comparator that orders documents by `sort`, as adapters must. */
export function compareBySort(
  sort: readonly SortSpec[],
): (a: DocumentData, b: DocumentData) => number {
  return (a, b) => {
    for (const { field, direction } of sort) {
      const result = compareValues(a[field], b[field]);
      if (result !== 0) return direction === "asc" ? result : -result;
    }
    return 0;
  };
}
