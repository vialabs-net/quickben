import { describe, expect, it } from "vitest";

import { createTextLayerExtractor, pdfPagesText } from "../src";

import { INVOICE_TEXT, invoice, invoiceTemplate, makePdf } from "./helpers";

const extractor = createTextLayerExtractor({ templates: { invoice: invoiceTemplate } });
const ctx = { tenant: "t1", config: { template: "invoice" } };

describe("text-layer extractor", () => {
  it("reads only the type's pages", async () => {
    const bytes = await makePdf(["page one", "page two", "page three"]);
    expect(await pdfPagesText(bytes, [1, 3, 9])).toMatch(/page one\s+page three/u);
  });

  it("reads an invoice from the PDF text, with boxes", async () => {
    const bytes = await makePdf([INVOICE_TEXT]);
    const result = await extractor.extract(
      { bytes, mime: "application/pdf", pages: [1, 2] },
      invoice,
      {},
      ctx,
    );
    expect(result.status).toBe("OK");
    expect(result.fields.number?.value).toBe("A1043");
    // makePdf draws the first line at y=360 of a 600x400 page, from x=20.
    const evidence = result.fields.number?.evidence;
    expect(evidence).toMatchObject({ page: 1, text: "A-1043" });
    expect(evidence?.box?.y0).toBeGreaterThan(0.05);
    expect(evidence?.box?.y1).toBeLessThan(0.15);
    expect(evidence?.box?.x0).toBeGreaterThan(20 / 600);
    expect(result.fields.total?.evidence?.box?.y0).toBeGreaterThan(evidence?.box?.y1 ?? 1);
  });

  it("has no text for an image or a blank PDF, and no match for another format", async () => {
    const image = await extractor.extract(
      { bytes: new Uint8Array([1]), mime: "image/jpeg", pages: [1] },
      invoice,
      {},
      ctx,
    );
    expect(image).toMatchObject({ status: "NO_TEXT", problems: { mime: "image/jpeg" } });
    const blank = await extractor.extract(
      { bytes: await makePdf([""]), mime: "application/pdf", pages: [1] },
      invoice,
      {},
      ctx,
    );
    expect(blank.status).toBe("NO_TEXT");
    const other = await extractor.extract(
      {
        bytes: await makePdf([INVOICE_TEXT.replaceAll("INVOICE", "RECEIPT")]),
        mime: "application/pdf",
        pages: [1],
      },
      invoice,
      {},
      ctx,
    );
    expect(other.status).toBe("NO_MATCH");
    expect(createTextLayerExtractor()).toMatchObject({ key: "text-layer", paid: false });
  });
});
