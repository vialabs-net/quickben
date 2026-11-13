import { describe, expect, it } from "vitest";

import { applyTemplate, readText } from "../src";
import { hasTextLayer } from "../src/text-readers";

import { INVOICE_TEXT, invoice, invoiceTemplate } from "./helpers";

const templates = { invoice: invoiceTemplate };

describe("applyTemplate", () => {
  it("captures the first matching rule per field", () => {
    expect(
      applyTemplate(
        {
          match: ["ORDER"],
          fields: {
            id: [{ pattern: "NOPE (\\d+)" }, { pattern: "ORDER (\\d+)" }],
            whole: [{ pattern: "ORDER \\d+", group: 0 }],
            missing: [{ pattern: "ABSENT (\\d+)" }],
          },
        },
        "ORDER   42\n shipped",
      ),
    ).toEqual({ id: "42", whole: "ORDER 42" });
    expect(applyTemplate({ fields: {} }, "anything")).toEqual({});
    expect(applyTemplate({ match: ["INVOICE"], fields: {} }, "a receipt")).toBeNull();
  });
});

describe("readText", () => {
  it("reads a document with a registered template and normalizes the values", () => {
    const result = readText(INVOICE_TEXT, invoice, {}, { template: "invoice" }, { templates });
    expect(result).toEqual({
      status: "OK",
      fields: {
        number: { value: "A1043", confidence: 0.9 },
        issuedOn: { value: "2026-03-05", confidence: 0.9 },
        total: { value: "1234.5", confidence: 0.9 },
        buyerTaxId: { value: "12345678K", confidence: 0.9 },
      },
    });
  });

  it("accepts an inline template and drops excluded values", () => {
    const result = readText(
      INVOICE_TEXT,
      invoice,
      { issuerTaxIds: "12345678-K" },
      { template: { match: ["INVOICE"], fields: invoiceTemplate.fields } },
    );
    expect(result.fields.buyerTaxId).toBeUndefined();
    expect(result.status).toBe("OK");
  });

  it("reports what is missing, no match, no text and bad configs", () => {
    const partial = readText(
      INVOICE_TEXT.replace("DATE", "DAY"),
      invoice,
      {},
      { template: "invoice" },
      { templates },
    );
    expect(partial).toMatchObject({ status: "INCOMPLETE", problems: { missing: ["issuedOn"] } });
    expect(
      readText(
        INVOICE_TEXT.replaceAll("INVOICE", "RECEIPT"),
        invoice,
        {},
        { template: "invoice" },
        { templates },
      ),
    ).toEqual({
      status: "NO_MATCH",
      fields: {},
    });
    expect(
      readText(`INVOICE ${"-".repeat(60)}`, invoice, {}, { template: "invoice" }, { templates })
        .status,
    ).toBe("NO_MATCH");
    expect(readText("short", invoice, {}, { template: "invoice" }, { templates }).status).toBe(
      "NO_TEXT",
    );
    expect(readText(INVOICE_TEXT, invoice, {}, { template: "nope" }).problems).toEqual({
      error: "unknown template nope",
    });
    expect(readText(INVOICE_TEXT, invoice, {}, { template: { fields: 3 } }).problems).toEqual({
      error: "invalid inline template",
    });
    expect(readText(INVOICE_TEXT, invoice, {}, {}).problems).toEqual({
      error: "a text-layer step needs config.template or config.reader",
    });
    expect(hasTextLayer(" a ".repeat(49))).toBe(false);
  });

  it("runs a registered reader function", () => {
    const readers = {
      totals: (text: string) => ({
        total: /TOTAL:\s*\$?([\d.,]+)/u.exec(text)?.[1],
        number: undefined,
      }),
    };
    const result = readText(INVOICE_TEXT, invoice, {}, { reader: "totals" }, { readers });
    expect(result).toMatchObject({ status: "INCOMPLETE", fields: { total: { value: "1234.5" } } });
    expect(readText(INVOICE_TEXT, invoice, {}, { reader: "nope" }, { readers }).problems).toEqual({
      error: "unknown reader nope",
    });
  });
});
