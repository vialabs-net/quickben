/**
 * What a vision model looks at: PDF pages rendered to PNG, or an uploaded JPEG, PNG or WebP as
 * it is. Rendering PDFs needs the optional peer dependency `@napi-rs/canvas`.
 */
import { getDocumentProxy, renderPageAsImage } from "unpdf";

export interface PageImage {
  /** 1-based page of the source document. */
  readonly page: number;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export type Rasterize = (
  bytes: Uint8Array,
  mime: string,
  pages: readonly number[],
) => Promise<PageImage[]>;

/** The file is neither a PDF nor an image a model can read. */
export class UnsupportedFileError extends Error {
  constructor(mime: string) {
    super(`unsupported file type ${mime}`);
    this.name = "UnsupportedFileError";
  }
}

export const IMAGE_MIMES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

// 2x is about 150 dpi for an A4 page: small print stays legible without sending megapixels
// the model bills as tokens.
const SCALE = 2;

// Loaded by Node at run time, never bundled: it is a native module and an optional peer.
const canvasModule = "@napi-rs/canvas";
const canvas = () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ canvasModule);

/** Render the given pages. Images pass through as page 1. */
export const rasterize: Rasterize = async (bytes, mime, pages) => {
  if (IMAGE_MIMES.has(mime)) return [{ page: 1, bytes, mime }];
  if (mime !== "application/pdf") throw new UnsupportedFileError(mime);
  // unpdf may detach the buffer it is given; pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const images: PageImage[] = [];
  for (const page of pages) {
    if (page > pdf.numPages) continue;
    const png = await renderPageAsImage(pdf, page, { canvasImport: canvas, scale: SCALE });
    images.push({ page, bytes: new Uint8Array(png), mime: "image/png" });
  }
  return images;
};
