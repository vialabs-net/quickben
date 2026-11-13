/* eslint-disable @typescript-eslint/no-misused-spread -- boxes split runs by code point, as pdf.js counts them */
/**
 * Where a value read from the text layer sits on its page, so the admin can highlight it.
 * Positions come from pdf.js text items. A value is located by its letters and digits only, so
 * `16482371-7` finds `16.482.371-7`.
 */
import type { FieldBox, FieldValue } from "../extractor";

/** One text run, its corners as page fractions (origin top left). */
export interface TextItem {
  readonly str: string;
  readonly box: FieldBox;
}

export interface PageText {
  /** 1-based. */
  readonly page: number;
  readonly items: readonly TextItem[];
}

const ALNUM = /[\p{L}\p{N}]/u;
const fold = (ch: string) => ch.normalize("NFD").replaceAll(/\p{M}/gu, "").toUpperCase();

/** The letters and digits of a value, folded for comparison. */
export function matchKey(value: string): string {
  return [...value]
    .filter((ch) => ALNUM.test(ch))
    .map(fold)
    .join("");
}

interface Char {
  readonly key: string;
  readonly item: number;
  readonly at: number;
}

function charsOf(items: readonly TextItem[]): Char[] {
  const chars: Char[] = [];
  items.forEach((item, index) => {
    [...item.str].forEach((ch, at) => {
      if (!ALNUM.test(ch)) return;
      for (const key of fold(ch)) chars.push({ key, item: index, at });
    });
  });
  return chars;
}

const width = (box: FieldBox) => box.x1 - box.x0;
const height = (box: FieldBox) => box.y1 - box.y0;

/** Two runs that touch on one line, like `16.482` and `.371-7` printed apart. */
function contiguous(left: TextItem | undefined, right: TextItem | undefined): boolean {
  if (!left || !right) return false;
  const lineHeight = Math.min(height(left.box), height(right.box));
  const glyph = Math.min(
    width(left.box) / [...left.str].length,
    width(right.box) / [...right.str].length,
  );
  return (
    Math.abs(left.box.y0 - right.box.y0) < lineHeight / 4 &&
    Math.abs(right.box.x0 - left.box.x1) < glyph / 3
  );
}

function charBefore(items: readonly TextItem[], first: Char): string | undefined {
  const own = [...(items[first.item]?.str ?? "")][first.at - 1];
  if (own !== undefined) return own;
  const previous = items[first.item - 1];
  return contiguous(previous, items[first.item]) ? [...(previous?.str ?? "")].at(-1) : undefined;
}

function charAfter(items: readonly TextItem[], last: Char): string | undefined {
  const own = [...(items[last.item]?.str ?? "")][last.at + 1];
  if (own !== undefined) return own;
  const next = items[last.item + 1];
  return contiguous(items[last.item], next) ? [...(next?.str ?? "")][0] : undefined;
}

/** A match must not start or end inside a longer word or number. */
function bounded(items: readonly TextItem[], first: Char, last: Char): boolean {
  const before = charBefore(items, first);
  const after = charAfter(items, last);
  return !(before && ALNUM.test(before)) && !(after && ALNUM.test(after));
}

function union(a: FieldBox | null, b: FieldBox): FieldBox {
  if (!a) return b;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** The box around a run of characters, splitting a partly matched item by character count. */
function boxOf(
  items: readonly TextItem[],
  run: readonly Char[],
): { box: FieldBox; text: string } | null {
  const spans = new Map<number, { from: number; to: number }>();
  for (const ch of run) {
    const span = spans.get(ch.item);
    if (span) span.to = ch.at;
    else spans.set(ch.item, { from: ch.at, to: ch.at });
  }
  let box: FieldBox | null = null;
  const texts: string[] = [];
  for (const [index, span] of spans) {
    const item = items[index];
    if (!item) continue;
    const chars = [...item.str];
    const itemWidth = width(item.box);
    box = union(box, {
      x0: item.box.x0 + (itemWidth * span.from) / chars.length,
      y0: item.box.y0,
      x1: item.box.x0 + (itemWidth * (span.to + 1)) / chars.length,
      y1: item.box.y1,
    });
    texts.push(chars.slice(span.from, span.to + 1).join(""));
  }
  return box ? { box, text: texts.join(" ").slice(0, 200) } : null;
}

/** The first whole-word occurrence of a value on a page, or `null`. */
export function findBox(
  items: readonly TextItem[],
  value: string,
): { box: FieldBox; text: string } | null {
  const key = matchKey(value);
  if (!key) return null;
  const chars = charsOf(items);
  const flat = chars.map((c) => c.key).join("");
  for (let at = flat.indexOf(key); at !== -1; at = flat.indexOf(key, at + 1)) {
    const run = chars.slice(at, at + key.length);
    const first = run[0];
    const last = run.at(-1);
    if (first && last && bounded(items, first, last)) return boxOf(items, run);
  }
  return null;
}

/**
 * Add `evidence` with a box to every field found on the given pages; the first page that has
 * it wins. Fields not found are left as they are.
 */
export function withBoxes(
  fields: Readonly<Record<string, FieldValue>>,
  pages: readonly PageText[],
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [key, field] of Object.entries(fields)) {
    out[key] = field;
    for (const page of pages) {
      const found = findBox(page.items, field.value);
      if (!found) continue;
      out[key] = { ...field, evidence: { page: page.page, text: found.text, box: found.box } };
      break;
    }
  }
  return out;
}

/** The parts of a pdf.js page this module needs. */
export interface PdfPageLike {
  getViewport(params: { scale: number }): {
    width: number;
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  getTextContent(): Promise<{ items: readonly object[] }>;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** Text runs of a page with their boxes, from pdf.js item transforms. */
export async function pageTextItems(page: PdfPageLike): Promise<TextItem[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const raw of content.items) {
    const item = raw as RawItem;
    if (!item.str?.trim() || !item.transform) continue;
    const [a = 0, b = 0, , d = 0, e = 0, f = 0] = item.transform;
    const [ox = 0, oy = 0] = viewport.convertToViewportPoint(e, f);
    const [ax = 0, ay = 0] = viewport.convertToViewportPoint(e + a, f + b);
    // Rotated runs stay unboxed rather than carry a misleading box.
    if (ax <= ox || Math.abs(ay - oy) > 0.001) continue;
    const size = item.height !== undefined && item.height > 0 ? item.height : Math.abs(d);
    // From a little below the baseline (descenders) to the cap height.
    const corners = [
      viewport.convertToViewportPoint(e, f - size * 0.25),
      viewport.convertToViewportPoint(e + (item.width ?? 0), f + size * 0.9),
    ];
    const xs = corners.map((p) => clamp((p[0] ?? 0) / viewport.width));
    const ys = corners.map((p) => clamp((p[1] ?? 0) / viewport.height));
    items.push({
      str: item.str,
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    });
  }
  return items;
}
