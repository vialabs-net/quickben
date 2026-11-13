import { describe, expect, it } from "vitest";

import { normalizeFieldValue, sameFieldValue } from "../src";
import { cleanValues } from "../src/field-values";

import { invoice } from "./helpers";

import type { FieldDefinition } from "../src";

const field = (rules: Partial<FieldDefinition> & Pick<FieldDefinition, "type">) => ({ ...rules });

describe("normalizeFieldValue", () => {
  it("collapses text and applies transforms and patterns", () => {
    expect(normalizeFieldValue(field({ type: "text" }), "  Ana   Soto ")).toBe("Ana Soto");
    expect(normalizeFieldValue(field({ type: "text", transform: "upper" }), "ab-1")).toBe("AB-1");
    expect(normalizeFieldValue(field({ type: "text", transform: "compact" }), "ab. 12-3")).toBe(
      "AB123",
    );
    const code = field({
      type: "text",
      transform: "compact",
      pattern: String.raw`^[A-Z]{2}\d{4}$`,
    });
    expect(normalizeFieldValue(code, "ab-1234")).toBe("AB1234");
    expect(normalizeFieldValue(code, "abc-123")).toBeNull();
    expect(normalizeFieldValue(field({ type: "text" }), "   ")).toBeNull();
    expect(normalizeFieldValue(field({ type: "text" }), null)).toBeNull();
  });

  it("reads dates as ISO, day first by default", () => {
    const date = field({ type: "date" });
    expect(normalizeFieldValue(date, "5/3/2026")).toBe("2026-03-05");
    expect(normalizeFieldValue(date, "05.03.2026")).toBe("2026-03-05");
    expect(normalizeFieldValue(date, "2026-03-05")).toBe("2026-03-05");
    expect(normalizeFieldValue(field({ type: "date", dateOrder: "mdy" }), "3/5/2026")).toBe(
      "2026-03-05",
    );
    expect(normalizeFieldValue(date, "31/02/2026")).toBeNull();
    expect(normalizeFieldValue(date, "1/13/2026")).toBeNull();
    expect(normalizeFieldValue(date, "March 5")).toBeNull();
  });

  it("reads numbers with either decimal separator", () => {
    expect(normalizeFieldValue(field({ type: "number" }), "$1,234.50")).toBe("1234.5");
    expect(
      normalizeFieldValue(field({ type: "number", decimalSeparator: "," }), "1.234,50 €"),
    ).toBe("1234.5");
    expect(normalizeFieldValue(field({ type: "number" }), "-42")).toBe("-42");
    expect(normalizeFieldValue(field({ type: "number" }), "1.2.3")).toBeNull();
    expect(normalizeFieldValue(field({ type: "number" }), "n/a")).toBeNull();
  });

  it("checks emails and phones", () => {
    expect(normalizeFieldValue(field({ type: "email" }), "Ana@Example.COM")).toBe(
      "ana@example.com",
    );
    for (const bad of ["ana", "@x.com", "a@b", "a@.com", "a@b.", "a b@c.com", "a@b@c.com"]) {
      expect(normalizeFieldValue(field({ type: "email" }), bad)).toBeNull();
    }
    expect(normalizeFieldValue(field({ type: "phone" }), "+56 9 1234 5678")).toBe("+56912345678");
    expect(normalizeFieldValue(field({ type: "phone" }), "(02) 555-1234")).toBe("025551234");
    expect(normalizeFieldValue(field({ type: "phone" }), "123")).toBeNull();
  });
});

describe("sameFieldValue", () => {
  it("compares normalized values, text without case", () => {
    expect(sameFieldValue(field({ type: "date" }), "2026-03-05", "05/03/2026")).toBe(true);
    expect(sameFieldValue(field({ type: "text" }), "ana soto", "ANA  SOTO")).toBe(true);
    expect(sameFieldValue(field({ type: "number" }), "1234.5", "1,234.50")).toBe(true);
    expect(sameFieldValue(field({ type: "number" }), "1234", "1,234.50")).toBe(false);
    expect(sameFieldValue(field({ type: "date" }), "not a date", "not a date")).toBe(true);
    expect(sameFieldValue(field({ type: "date" }), undefined, null)).toBe(true);
  });
});

describe("cleanValues", () => {
  it("drops unknown keys, invalid values and excluded values", () => {
    const values = cleanValues(
      invoice,
      { issuerTaxIds: ["76.543.210-K", "1"] },
      {
        number: { value: "a-1", confidence: 1 },
        issuedOn: { value: "99/99/2026", confidence: 1 },
        buyerTaxId: { value: "76543210-k", confidence: 1 },
        other: { value: "x", confidence: 1 },
        total: undefined,
      },
    );
    expect(values).toEqual({ number: { value: "A1", confidence: 1 } });
  });
});
