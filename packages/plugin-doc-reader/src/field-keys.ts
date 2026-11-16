/**
 * Field keys may have dot-separated segments (`vehicle.make`), each one camelCase. A type can
 * then mirror a nested JSON: {@link nestValues} builds it from read values and
 * {@link flattenValues} turns a nested object into values by key.
 */

/** One segment: camelCase, starting with a lowercase letter. */
const SEGMENT = "[a-z][a-zA-Z\\d]*";

/** A field key: camelCase segments joined by `.`. */
export const FIELD_KEY = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`, "u");

/** Longest field key. */
export const FIELD_KEY_MAX = 120;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A nested object as values by dotted key: `{ vehicle: { make: "X" } }` → `{ "vehicle.make":
 * "X" }`. Arrays and other non-object values are kept as they are, under their key.
 */
export function flattenValues(value: unknown, prefix = ""): Record<string, unknown> {
  if (!isPlainObject(value)) return prefix ? { [prefix]: value } : {};
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(inner)) Object.assign(out, flattenValues(inner, path));
    else out[path] = inner;
  }
  return out;
}

/**
 * Values by dotted key as a nested object: `{ "vehicle.make": "X" }` → `{ vehicle: { make: "X"
 * } }`. A key that is both a value and a parent (`a` and `a.b`) keeps the value under `a`.
 */
export function nestValues<T>(values: Readonly<Record<string, T>>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const branches = new Set([out]);
  const keys = Object.keys(values).sort((a, b) => a.split(".").length - b.split(".").length);
  for (const key of keys) {
    const parts = key.split(".");
    let node = out;
    let blocked = false;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (next === undefined) {
        const child = Object.create(null) as Record<string, unknown>;
        node[part] = child;
        branches.add(child);
        node = child;
      } else if (isPlainObject(next) && branches.has(next)) {
        node = next;
      } else {
        blocked = true;
        break;
      }
    }
    const last = parts.at(-1);
    if (!blocked && last !== undefined) node[last] = values[key];
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}
