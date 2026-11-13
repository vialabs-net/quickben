/**
 * Conditions in templates: `order.paid`, `customer.type == 'company'`, `total >= 1000 and not
 * order.cancelled`.
 *
 * Grammar:
 *
 *     expr := or
 *     or   := and (("or" | "||") and)*
 *     and  := not (("and" | "&&") not)*
 *     not  := ("not" | "!") not | cmp
 *     cmp  := atom (("==" | "!=" | "<" | "<=" | ">" | ">=") atom)?
 *     atom := path | 'text' | "text" | number | true | false | null | "(" expr ")"
 *
 * A path is a catalog variable. A list is true when it has items. Expressions are parsed into a
 * tree and evaluated: nothing is executed, and paths read own properties of the data only.
 */
import { lookup } from "./values";

import type { CatalogVariable } from "./kinds";
import type { TemplateData } from "./values";

/** A parsed condition. */
export type Expr =
  | { type: "path"; path: string }
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "not"; arg: Expr }
  | { type: "and" | "or"; left: Expr; right: Expr }
  | { type: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; left: Expr; right: Expr };

type CompareType = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

/** A condition that cannot be parsed. The message says why. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

/** Longest condition, in characters. */
export const MAX_EXPRESSION_LENGTH = 300;

type Token =
  | { kind: "path"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "op"; text: string };

const keywords: Readonly<Record<string, string>> = { and: "&&", or: "||", not: "!" };
const comparisons: Readonly<Record<string, CompareType>> = {
  "==": "eq",
  "!=": "neq",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
};
const twoChar = new Set(["==", "!=", "&&", "||", "<=", ">="]);
const oneChar = new Set(["!", "(", ")", "<", ">"]);

const numberPattern = /^-?\d+(?:\.\d+)?/;
const wordPattern = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/;

function wordToken(source: string): { token: Token; length: number } | null {
  const number = numberPattern.exec(source);
  if (number) return { token: { kind: "number", text: number[0] }, length: number[0].length };
  const word = wordPattern.exec(source);
  if (!word) return null;
  const text = word[0];
  const keyword = Object.hasOwn(keywords, text) ? keywords[text] : undefined;
  return {
    token: keyword ? { kind: "op", text: keyword } : { kind: "path", text },
    length: text.length,
  };
}

/** The token at `i` and its length; `null` token for whitespace. */
function readToken(source: string, i: number): { token: Token | null; length: number } {
  const c = source.charAt(i);
  if (/\s/.test(c)) return { token: null, length: 1 };
  const two = source.slice(i, i + 2);
  if (twoChar.has(two)) return { token: { kind: "op", text: two }, length: 2 };
  if (oneChar.has(c)) return { token: { kind: "op", text: c }, length: 1 };
  if (c === "=") throw new ExpressionError("Use == to compare");
  if (c === "'" || c === '"') {
    const end = source.indexOf(c, i + 1);
    if (end < 0) throw new ExpressionError("Close the quotes");
    return { token: { kind: "string", text: source.slice(i + 1, end) }, length: end + 1 - i };
  }
  const match = wordToken(source.slice(i));
  if (!match) throw new ExpressionError(`Unexpected "${c}"`);
  return match;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const { token, length } = readToken(source, i);
    if (token) tokens.push(token);
    i += length;
  }
  return tokens;
}

const literalWords: Readonly<Record<string, boolean | null>> = {
  true: true,
  false: false,
  null: null,
};

/** Parse a condition. Throws {@link ExpressionError}. */
export function parseExpression(source: string): Expr {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ExpressionError("The condition is too long");
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new ExpressionError("Write a condition");
  let pos = 0;
  const isOp = (text: string) => {
    const token = tokens[pos];
    return token?.kind === "op" && token.text === text;
  };

  const atom = (): Expr => {
    const token = tokens[pos];
    if (!token) throw new ExpressionError("The condition is incomplete");
    pos += 1;
    switch (token.kind) {
      case "string":
        return { type: "literal", value: token.text };
      case "number":
        return { type: "literal", value: Number(token.text) };
      case "path":
        return Object.hasOwn(literalWords, token.text)
          ? { type: "literal", value: literalWords[token.text] ?? null }
          : { type: "path", path: token.text };
      default: {
        if (token.text !== "(") throw new ExpressionError(`Unexpected "${token.text}"`);
        const inner = or();
        if (!isOp(")")) throw new ExpressionError("Close the parenthesis");
        pos += 1;
        return inner;
      }
    }
  };
  const cmp = (): Expr => {
    const left = atom();
    const token = tokens[pos];
    const type =
      token?.kind === "op" && Object.hasOwn(comparisons, token.text)
        ? comparisons[token.text]
        : undefined;
    if (!type) return left;
    pos += 1;
    return { type, left, right: atom() };
  };
  const not = (): Expr => {
    if (!isOp("!")) return cmp();
    pos += 1;
    return { type: "not", arg: not() };
  };
  const and = (): Expr => {
    let left = not();
    while (isOp("&&")) {
      pos += 1;
      left = { type: "and", left, right: not() };
    }
    return left;
  };
  function or(): Expr {
    let left = and();
    while (isOp("||")) {
      pos += 1;
      left = { type: "or", left, right: and() };
    }
    return left;
  }

  const tree = or();
  const extra = tokens[pos];
  if (extra) throw new ExpressionError(`Unexpected "${extra.text}"`);
  return tree;
}

/* Evaluation */

const truthy = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

function valueOf(expr: Expr, data: TemplateData): unknown {
  if (expr.type === "path") return lookup(data, expr.path);
  if (expr.type === "literal") return expr.value;
  return evaluate(expr, data);
}

/** A string, number or boolean as text; `null` for anything else. */
function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return !Array.isArray(left);
  const a = scalar(left);
  return a !== null && a === scalar(right);
}

/** A number, or a string that is one. */
function numeric(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function order(left: unknown, right: unknown): number | null {
  const a = numeric(left);
  const b = numeric(right);
  if (a !== null && b !== null) return a - b;
  if (typeof left !== "string" || typeof right !== "string") return null;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compare(type: CompareType, left: unknown, right: unknown): boolean {
  if (type === "eq") return same(left, right);
  if (type === "neq") return !same(left, right);
  const diff = order(left, right);
  if (diff === null) return false;
  switch (type) {
    case "lt":
      return diff < 0;
    case "lte":
      return diff <= 0;
    case "gt":
      return diff > 0;
    default:
      return diff >= 0;
  }
}

/** Evaluate a parsed condition against the data. */
export function evaluate(expr: Expr, data: TemplateData): boolean {
  switch (expr.type) {
    case "path":
    case "literal":
      return truthy(valueOf(expr, data));
    case "not":
      return !evaluate(expr.arg, data);
    case "and":
      return evaluate(expr.left, data) && evaluate(expr.right, data);
    case "or":
      return evaluate(expr.left, data) || evaluate(expr.right, data);
    default:
      return compare(
        expr.type,
        valueOf(expr.left, data) ?? null,
        valueOf(expr.right, data) ?? null,
      );
  }
}

/** Evaluate a condition. One that cannot be parsed is `false`: validation reports it. */
export function test(source: string, data: TemplateData): boolean {
  try {
    return evaluate(parseExpression(source), data);
  } catch (error) {
    if (error instanceof ExpressionError) return false;
    throw error;
  }
}

/* Validation against a catalog */

function checkComparison(
  expr: Extract<Expr, { left: Expr; right: Expr }>,
  find: (path: string) => CatalogVariable | undefined,
): string | null {
  const [pathSide, literalSide] =
    expr.left.type === "path" ? [expr.left, expr.right] : [expr.right, expr.left];
  if (pathSide.type !== "path" || literalSide.type !== "literal") return null;
  const variable = find(pathSide.path);
  if (!variable) return null;
  const value = literalSide.value;
  const ordered = expr.type !== "eq" && expr.type !== "neq";
  if (variable.type === "list") {
    return `"${variable.label}" is a list: use it alone to test whether it has items`;
  }
  if (variable.type === "boolean" && (ordered || (typeof value !== "boolean" && value !== null))) {
    return `"${variable.label}" is true or false: compare it with true or false`;
  }
  if (ordered && variable.type !== "number" && variable.type !== "date") {
    return `"${variable.label}" is not a number or a date: use == or !=`;
  }
  if (
    variable.type === "enum" &&
    typeof value === "string" &&
    !variable.values?.some((v) => v.value === value)
  ) {
    const values = (variable.values ?? []).map((v) => `'${v.value}'`).join(", ");
    return `"${variable.label}" is never '${value}'. Values: ${values}`;
  }
  return null;
}

/** Problems of a condition: syntax, unknown variables and comparisons that never match. */
export function checkExpression(source: string, catalog: readonly CatalogVariable[]): string[] {
  let tree: Expr;
  try {
    tree = parseExpression(source);
  } catch (error) {
    if (error instanceof ExpressionError) return [error.message];
    throw error;
  }
  const errors: string[] = [];
  const find = (path: string) => catalog.find((v) => v.path === path);
  const visit = (expr: Expr): void => {
    switch (expr.type) {
      case "path":
        if (!find(expr.path)) errors.push(`Unknown variable "${expr.path}"`);
        return;
      case "literal":
        return;
      case "not":
        visit(expr.arg);
        return;
      case "and":
      case "or":
        visit(expr.left);
        visit(expr.right);
        return;
      default: {
        visit(expr.left);
        visit(expr.right);
        const problem = checkComparison(expr, find);
        if (problem) errors.push(problem);
      }
    }
  };
  visit(tree);
  return errors;
}
