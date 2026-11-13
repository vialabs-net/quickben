import { ValidationError } from "@quickben/core";

/**
 * Query of `GET /:collection`, as read from the query string. Values are passed to
 * `qb.find`, which validates them against the collection.
 */
export interface FindParams {
  where?: unknown;
  sort?: string[];
  limit?: number;
  page?: number;
  cursor?: string;
  depth?: number;
  select?: string[];
}

/** Options of {@link parseFindParams}. */
export interface ParseOptions {
  /** Largest `limit` accepted. */
  maxLimit: number;
}

const findKeys = new Set(["where", "sort", "limit", "page", "cursor", "depth", "select"]);
const readKeys = new Set(["depth", "select"]);

function invalid(path: string, message: string): ValidationError {
  return new ValidationError([{ path, message }]);
}

function single(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) throw invalid(key, "Give this parameter once");
  return values[0];
}

function integer(params: URLSearchParams, key: string): number | undefined {
  const value = single(params, key);
  if (value === undefined) return undefined;
  if (!/^\d{1,9}$/.test(value)) throw invalid(key, "Expected a non-negative integer");
  return Number(value);
}

/** `sort=-a,b` and `sort=-a&sort=b` both give `["-a", "b"]`. */
function list(params: URLSearchParams, key: string): string[] | undefined {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return values.length > 0 ? values : undefined;
}

function assertKnown(params: URLSearchParams, allowed: ReadonlySet<string>) {
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      throw invalid(key, `Unknown query parameter. Allowed: ${[...allowed].join(", ")}`);
    }
  }
}

function parseWhere(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  let where: unknown;
  try {
    where = JSON.parse(raw);
  } catch {
    throw invalid("where", "Expected a JSON object");
  }
  if (typeof where !== "object" || where === null || Array.isArray(where)) {
    throw invalid("where", "Expected a JSON object");
  }
  return where;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * Parse the query string of `GET /:collection`.
 *
 * | Parameter | Format                                   | Example                              |
 * | --------- | ---------------------------------------- | ------------------------------------ |
 * | `where`   | JSON, same shape as the local API        | `where={"status":{"eq":"draft"}}`    |
 * | `sort`    | comma-separated keys, `-` for descending | `sort=-publishedAt,title`            |
 * | `limit`   | integer, at most `maxLimit`              | `limit=50`                           |
 * | `page`    | integer, from 1                          | `page=2`                             |
 * | `cursor`  | `nextCursor` of the previous page        | `cursor=eyJ2Ij…`                     |
 * | `depth`   | integer 0–3                              | `depth=1`                            |
 * | `select`  | comma-separated field names              | `select=title,status`                |
 *
 * Unknown parameters are rejected, so a typo does not silently return everything.
 */
export function parseFindParams(params: URLSearchParams, options: ParseOptions): FindParams {
  assertKnown(params, findKeys);
  const limit = integer(params, "limit");
  if (limit !== undefined && limit > options.maxLimit) {
    throw invalid("limit", `Expected at most ${options.maxLimit}`);
  }
  return compact({
    where: parseWhere(single(params, "where")),
    sort: list(params, "sort"),
    limit,
    page: integer(params, "page"),
    cursor: single(params, "cursor"),
    depth: integer(params, "depth"),
    select: list(params, "select"),
  });
}

/** Parse the query string of `GET /:collection/:id`: only `depth` and `select`. */
export function parseReadParams(params: URLSearchParams): Pick<FindParams, "depth" | "select"> {
  assertKnown(params, readKeys);
  return compact({ depth: integer(params, "depth"), select: list(params, "select") });
}

/** Query accepted by {@link toSearchParams}. */
export interface FindQueryInput {
  where?: object;
  sort?: string | readonly string[];
  limit?: number;
  page?: number;
  cursor?: string;
  depth?: number;
  select?: readonly string[];
}

/**
 * Encode a query for `GET /:collection`. The inverse of {@link parseFindParams}, for clients:
 * `fetch(`/api/posts?${toSearchParams({ where: { status: { eq: "draft" } } })}`)`.
 */
export function toSearchParams(query: FindQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  if (query.where !== undefined) params.set("where", JSON.stringify(query.where));
  if (query.sort !== undefined) {
    params.set("sort", typeof query.sort === "string" ? query.sort : query.sort.join(","));
  }
  for (const key of ["limit", "page", "depth"] as const) {
    const value = query[key];
    if (value !== undefined) params.set(key, String(value));
  }
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.select !== undefined) params.set("select", query.select.join(","));
  return params;
}
