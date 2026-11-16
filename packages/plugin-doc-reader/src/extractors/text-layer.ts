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

/** A field's evidence, with where its box comes from. */
export interface LocatedEvidence extends FieldEvidence {
  readonly source?: "text-layer" | "model";
}

/**
 * Boxes for the values read, from the PDF's text layer: each value (else its evidence text) is
 * looked up in the text runs of its evidence page, then of the other pages. A value not found
 * keeps the box the vision model drew (`source: "model"`); scans have no text layer, so their
 * boxes always come from the model.
 */
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
    for (const page of ordered) {
      const found =
        findBox(page.items, field.value) ??
        (field.evidence?.text ? findBox(page.items, field.evidence.text) : null);
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
