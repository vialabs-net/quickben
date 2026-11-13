import { extractText, getDocumentProxy } from "unpdf";

import { readText } from "../text-readers";

import { pageTextItems, withBoxes } from "./text-boxes";

import type { Extractor } from "../extractor";
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
