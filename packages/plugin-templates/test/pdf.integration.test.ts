/**
 * Renders a real PDF with Chromium. Runs only with QUICKBEN_TEST_PDF=1 and a Chromium binary
 * (CHROMIUM_PATH, or a common install path).
 */
import { describe, expect, it } from "vitest";

import { renderPdf, saveBrand } from "../src";
import { chromiumPath, chromiumRenderer } from "../src/chromium";

import { setup, system } from "./fixtures";

const enabled = process.env.QUICKBEN_TEST_PDF === "1" && chromiumPath() !== null;

describe.runIf(enabled)("PDF with Chromium", () => {
  it("renders the letterhead on every page", async () => {
    const renderer = chromiumRenderer({ timeoutMs: 60_000 });
    try {
      const qb = await setup({ pdf: renderer });
      await saveBrand(
        qb,
        { displayName: "Acme", legalName: "Acme Inc.", footer: "Thanks" },
        system,
      );
      const { pdf, title } = await renderPdf(qb, {
        kind: "invoice",
        data: { customer: { name: "Bob" }, invoice: { number: "7" } },
        reference: "INV 7",
      });
      expect(title).toBe("Invoice");
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
    } finally {
      await renderer.close();
    }
  }, 60_000);
});
