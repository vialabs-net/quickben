import type { JsonSchema } from "./types";

/** A change of a value constraint: `narrowed` accepts fewer values, `widened` more. */
export interface ConstraintChange {
  narrowed: boolean;
  message: string;
}

const upperBounds = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"];
const lowerBounds = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"];

function numberAt(schema: JsonSchema, key: string): number | undefined {
  const value = schema[key];
  return typeof value === "number" ? value : undefined;
}

function boundChange(
  key: string,
  b: JsonSchema,
  h: JsonSchema,
  upper: boolean,
): ConstraintChange | undefined {
  const bv = numberAt(b, key);
  const hv = numberAt(h, key);
  if (bv === hv) return undefined;
  const from = bv === undefined ? "none" : String(bv);
  const to = hv === undefined ? "none" : String(hv);
  let narrowed: boolean;
  if (hv === undefined) narrowed = false;
  else if (bv === undefined) narrowed = true;
  else narrowed = upper ? hv < bv : hv > bv;
  return { narrowed, message: `${key} changed from ${from} to ${to}` };
}

function textChange(key: string, b: JsonSchema, h: JsonSchema): ConstraintChange[] {
  const bv = b[key];
  const hv = h[key];
  if (bv === hv) return [];
  const message = `${key} changed from ${JSON.stringify(bv ?? null)} to ${JSON.stringify(hv ?? null)}`;
  // A changed pattern or format may reject old values and allow new ones.
  if (typeof bv === "string" && typeof hv === "string") {
    return [
      { narrowed: true, message },
      { narrowed: false, message },
    ];
  }
  return [{ narrowed: typeof hv === "string", message }];
}

/** Changes of bounds (`maximum`, `maxLength`, …), `pattern` and `format`. */
export function constraintChanges(b: JsonSchema, h: JsonSchema): ConstraintChange[] {
  const changes: ConstraintChange[] = [];
  for (const key of upperBounds) {
    const change = boundChange(key, b, h, true);
    if (change) changes.push(change);
  }
  for (const key of lowerBounds) {
    const change = boundChange(key, b, h, false);
    if (change) changes.push(change);
  }
  changes.push(...textChange("pattern", b, h), ...textChange("format", b, h));
  return changes;
}
