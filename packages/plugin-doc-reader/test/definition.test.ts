import { describe, expect, it } from "vitest";

import { classifyType, listParam, parseDocumentType, requiredFields } from "../src";

import { invoice, invoiceInput } from "./helpers";

describe("document types", () => {
  it("fills defaults", () => {
    const type = parseDocumentType({
      key: "receipt",
      version: 1,
      label: "Receipt",
      fields: [{ key: "total", label: "Total", type: "number" }],
      pipeline: { steps: [{ extractor: "text-layer" }] },
    });
    expect(type).toMatchObject({
      state: "draft",
      pages: [1],
      params: [],
      instructions: "",
      classification: { text: [], fileName: [] },
      pipeline: {
        threshold: 0.8,
        stopWhen: "required",
        steps: [{ extractor: "text-layer", config: {} }],
      },
      fields: [{ required: false }],
    });
    expect(requiredFields(invoice)).toEqual(["number", "issuedOn"]);
  });

  it("lists every problem", () => {
    const result = (() => {
      try {
        parseDocumentType({
          ...invoiceInput,
          key: "Not Kebab",
          fields: [
            { key: "a", label: "A", type: "text" },
            { key: "a", label: "A again", type: "text", pattern: "(" },
          ],
          params: [
            { key: "p", label: "P", type: "string", excludes: ["missing"] },
            { key: "p", label: "P again", type: "string" },
          ],
          classification: { text: ["["] },
        });
        return null;
      } catch (error) {
        return (error as { issues: { path: (string | number)[] }[] }).issues.map((i) =>
          i.path.join("."),
        );
      }
    })();
    expect(result).toEqual(
      expect.arrayContaining([
        "key",
        "fields.1.pattern",
        "classification.text.0",
        "fields.1.key",
        "params.0.excludes.0",
        "params.1.key",
      ]),
    );
  });

  it("reads list parameters from a string or a list", () => {
    expect(listParam({ a: "x", b: ["y", "z"] }, "a")).toEqual(["x"]);
    expect(listParam({ a: "x", b: ["y", "z"] }, "b")).toEqual(["y", "z"]);
    expect(listParam({}, "toString")).toEqual([]);
  });
});

describe("classifyType", () => {
  const receipt = parseDocumentType({
    key: "receipt",
    version: 1,
    label: "Receipt",
    fields: [{ key: "total", label: "Total", type: "number" }],
    classification: { text: ["RECEIPT"], fileName: ["^rcpt"] },
    pipeline: { steps: [{ extractor: "text-layer" }] },
  });

  it("matches the first page's text first, then the file name", () => {
    expect(classifyType([receipt, invoice], "x.pdf", "Thank you\n\nINVOICE NO. 1")?.key).toBe(
      "invoice",
    );
    expect(classifyType([receipt, invoice], "rcpt-0001.PDF", null)?.key).toBe("receipt");
    expect(classifyType([receipt, invoice], "rcpt-0001.pdf", "   ")?.key).toBe("receipt");
    expect(classifyType([receipt, invoice], "scan.jpg", "nothing here")).toBeNull();
  });
});
