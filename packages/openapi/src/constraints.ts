import type { JsonSchema } from "./types";

/** A change of a value constraint: `narrowed` accepts fewer values, `widened` more. */
export interface ConstraintChange {
  narrowed: boolean;
  message: string;
}

const upperBounds = ["maxLength", "maxItems", "maxProperties"];
const lowerBounds = ["minLength", "minItems", "minProperties"];

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

function numericBound(schema: JsonSchema, upper: boolean): { value: number; exclusive: boolean } {
  const fallback = upper ? Infinity : -Infinity;
  const inclusive = numberAt(schema, upper ? "maximum" : "minimum") ?? fallback;
  const exclusive = numberAt(schema, upper ? "exclusiveMaximum" : "exclusiveMinimum");
  if (exclusive === undefined) return { value: inclusive, exclusive: false };
  const stricter = upper ? exclusive <= inclusive : exclusive >= inclusive;
  return stricter ? { value: exclusive, exclusive: true } : { value: inclusive, exclusive: false };
}

function numericChange(b: JsonSchema, h: JsonSchema, upper: boolean): ConstraintChange[] {
  const before = numericBound(b, upper);
  const after = numericBound(h, upper);
  if (before.value === after.value && before.exclusive === after.exclusive) return [];
  let narrowed = after.exclusive;
  if (before.value !== after.value)
    narrowed = upper ? after.value < before.value : after.value > before.value;
  return [
    {
      narrowed,
      message: `${upper ? "maximum" : "minimum"} bound changed from ${before.exclusive ? "exclusive " : ""}${String(before.value)} to ${after.exclusive ? "exclusive " : ""}${String(after.value)}`,
    },
  ];
}

/** Strings, including conjunctions of patterns used internally when flattening allOf. */
export function textConstraints(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? (value as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
}

function textChange(key: string, b: JsonSchema, h: JsonSchema): ConstraintChange[] {
  const before = textConstraints(b[key]);
  const after = textConstraints(h[key]);
  const message = `${key} changed from ${JSON.stringify(b[key] ?? null)} to ${JSON.stringify(h[key] ?? null)}`;
  const changes: ConstraintChange[] = [];
  if (after.some((item) => !before.includes(item))) changes.push({ narrowed: true, message });
  if (before.some((item) => !after.includes(item))) changes.push({ narrowed: false, message });
  return changes;
}

function multipleChanges(b: JsonSchema, h: JsonSchema): ConstraintChange[] {
  const before = numberAt(b, "multipleOf");
  const after = numberAt(h, "multipleOf");
  if (before === after) return [];
  const message = `multipleOf changed from ${String(before ?? "none")} to ${String(after ?? "none")}`;
  const divides = (a: number, value: number) => {
    const ratio = value / a;
    return Math.abs(ratio - Math.round(ratio)) <= Number.EPSILON * Math.max(1, Math.abs(ratio)) * 4;
  };
  const changes: ConstraintChange[] = [];
  if (after !== undefined && (before === undefined || !divides(after, before)))
    changes.push({ narrowed: true, message });
  if (before !== undefined && (after === undefined || !divides(before, after)))
    changes.push({ narrowed: false, message });
  return changes;
}

/** Changes of bounds (`maximum`, `maxLength`, …), `pattern` and `format`. */
export function constraintChanges(b: JsonSchema, h: JsonSchema): ConstraintChange[] {
  const changes: ConstraintChange[] = [...numericChange(b, h, true), ...numericChange(b, h, false)];
  for (const key of upperBounds) {
    const change = boundChange(key, b, h, true);
    if (change) changes.push(change);
  }
  for (const key of lowerBounds) {
    const change = boundChange(key, b, h, false);
    if (change) changes.push(change);
  }
  changes.push(
    ...textChange("pattern", b, h),
    ...textChange("format", b, h),
    ...multipleChanges(b, h),
  );
  return changes;
}
