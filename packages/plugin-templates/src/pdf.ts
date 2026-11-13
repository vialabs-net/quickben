/** What a PDF renderer gets: the document body and its letterhead, as HTML. */
export interface PdfInput {
  /** Document title, for the PDF metadata. */
  title: string;
  /** Author for the PDF metadata: the brand's legal or display name. */
  author: string | null;
  /** The body. Its `@page` rule sets the size and the margins left for the letterhead. */
  html: string;
  /** One transparent page with the letterhead and footer, to draw over every page. */
  letterhead: string;
}

/**
 * Turns rendered HTML into a PDF. `@quickben/plugin-templates/chromium` has one that uses
 * headless Chromium; any other engine works if it follows `@page` rules.
 */
export interface PdfRenderer {
  render(input: PdfInput): Promise<Uint8Array>;
  /** Free resources, e.g. close the browser. */
  close?(): Promise<void>;
}

/** The PDF renderer is missing, busy or failed. */
export class RendererUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RendererUnavailableError";
  }
}
