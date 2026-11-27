import { extractText, getDocumentProxy } from "unpdf";

import { readText } from "../text-readers";

import { findBox, pageTextItems, withBoxes } from "./text-boxes";

import type { Extractor, FieldEvidence, FieldValue } from "../extractor";
import type { TextReaders } from "../text-readers";
import type { PageText, PdfPageLike } from "./text-boxes";

export const TEXT_LAYER = "text-layer";

export const PDF = "application/pdf";

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

// unpdf may detach the buffer it is given; pass a copy.
const open = (bytes: Uint8Array) => getDocumentProxy(new Uint8Array(bytes));

async function pagesText(pdf: Pdf, pages: readonly number[]): Promise<string> {
  const { text } = await extractText(pdf, { mergePages: false });
  return pages
    .map((page) => text[page - 1])
    .filter((pageText): pageText is string => pageText !== undefined)
    .join("\n");
}

/** Text of the given 1-based pages of a PDF. Pages past the end are ignored. */
export async function pdfPagesText(bytes: Uint8Array, pages: readonly number[]): Promise<string> {
  return pagesText(await open(bytes), pages);
}

async function pdfPageItems(pdf: Pdf, pages: readonly number[]): Promise<PageText[]> {
  const out: PageText[] = [];
  for (const page of pages) {
    if (page > pdf.numPages) continue;
    const proxy = (await pdf.getPage(page)) as unknown as PdfPageLike;
    out.push({ page, items: await pageTextItems(proxy) });
  }
  return out;
}

/** Text runs with their boxes, for the given 1-based pages of a PDF. */
export async function pdfPagesItems(
  bytes: Uint8Array,
  pages: readonly number[],
): Promise<PageText[]> {
  return pdfPageItems(await open(bytes), pages);
}

/** A field's evidence, with where its box comes from. */
export interface LocatedEvidence extends FieldEvidence {
  readonly source?: "text-layer" | "model";
}

function searchTexts(field: FieldValue): string[] {
  const evidence = field.evidence?.text ?? "";
  const separator = evidence.indexOf(":");
  const hasLabel = separator >= 0 && /\p{L}/u.test(evidence.slice(0, separator));
  const afterLabel = hasLabel ? evidence.slice(separator + 1).trim() : "";
  return [field.value, afterLabel, evidence].filter(
    (text, index, all) => text !== "" && all.indexOf(text) === index,
  );
}

/** The first candidate found on a page. */
function firstBox(items: PageText["items"], candidates: readonly string[]) {
  for (const text of candidates) {
    const found = findBox(items, text);
    if (found) return found;
  }
  return null;
}

/** Find evidence in PDF text, preferring the reported page. Keep the model box as a fallback. */
export async function locateEvidence(
  bytes: Uint8Array,
  mime: string,
  pages: readonly number[],
  fields: Readonly<Record<string, FieldValue>>,
): Promise<Record<string, FieldValue & { evidence?: LocatedEvidence }>> {
  const marked = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      field.evidence?.box
        ? { ...field, evidence: { ...field.evidence, source: "model" as const } }
        : field,
    ]),
  );
  if (mime !== PDF || Object.keys(fields).length === 0) return marked;
  let texts: PageText[];
  try {
    texts = await pdfPageItems(await open(bytes), pages);
  } catch {
    return marked;
  }
  if (texts.every((page) => page.items.length === 0)) return marked;
  const out: Record<string, FieldValue & { evidence?: LocatedEvidence }> = { ...marked };
  for (const [key, field] of Object.entries(fields)) {
    const first = field.evidence?.page;
    const ordered = [...texts].sort((a, b) => Number(b.page === first) - Number(a.page === first));
    const candidates = searchTexts(field);
    for (const page of ordered) {
      const found = firstBox(page.items, candidates);
      if (!found) continue;
      out[key] = {
        ...field,
        evidence: {
          page: page.page,
          text:
            field.evidence?.text === undefined || field.evidence.text === ""
              ? found.text
              : field.evidence.text,
          box: found.box,
          source: "text-layer",
        },
      };
      break;
    }
  }
  return out;
}

/**
 * Free: the PDF's own text, read by a regex template or a reader function. Fields read get a
 * box on their page when the value can be found in the text runs.
 */
export function createTextLayerExtractor(readers: TextReaders = {}): Extractor {
  return {
    key: TEXT_LAYER,
    paid: false,
    async extract(input, type, params, ctx) {
      if (input.mime !== PDF) {
        return { status: "NO_TEXT", fields: {}, problems: { mime: input.mime } };
      }
      const pdf = await open(input.bytes);
      const result = readText(await pagesText(pdf, input.pages), type, params, ctx.config, readers);
      if (Object.keys(result.fields).length === 0) return result;
      // Boxes only help the viewer: failing to place them never fails the read.
      try {
        return {
          ...result,
          fields: withBoxes(result.fields, await pdfPageItems(pdf, input.pages)),
        };
      } catch {
        return result;
      }
    },
  };
}
