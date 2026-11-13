import { ConfigError } from "@quickben/core";
import { describe, expect, it } from "vitest";

import { defineTemplateKind, templates } from "../src";
import { resolveKind } from "../src/kinds";
import { resolveOptions } from "../src/options";

import { invoice, letter } from "./fixtures";

describe("defineTemplateKind", () => {
  it("returns the definition and fills defaults when resolved", () => {
    const resolved = resolveKind(invoice);
    expect(resolved.catalog.find((v) => v.path === "invoice.number")).toEqual({
      path: "invoice.number",
      label: "Invoice number",
      group: "Data",
      type: "text",
    });
    expect(resolved.catalog.at(-1)?.path).toBe("brand.contact");
    expect(resolved.sampleData).toMatchObject({
      customer: { name: "Ada Lovelace", type: "company" },
      invoice: { number: "INV-0042", total: 1234.5 },
    });
    expect(resolved.formats.get("invoice.currency")?.("x")).toBe("[x]");
    expect(resolveKind(letter)).toMatchObject({
      description: null,
      baseTemplate: null,
      requireSignature: false,
    });
  });

  it("keeps given sample data and overwrites non-object parents", () => {
    const kind = resolveKind({
      kind: "k",
      label: "K",
      catalog: [
        { path: "a", label: "A", sample: "x" },
        { path: "a.b", label: "B", sample: 1 },
        {
          path: "list",
          label: "L",
          type: "list",
          fields: [{ key: "x", label: "X" }],
          hint: "h",
          placeholder: "-",
        },
      ],
    });
    expect(kind.sampleData).toEqual({ a: { b: 1 } });
    expect(kind.catalog[2]).toMatchObject({
      hint: "h",
      placeholder: "-",
      fields: [{ key: "x", label: "X" }],
    });
    expect(
      resolveKind({ kind: "k", label: "K", catalog: [], sampleData: { z: 1 } }).sampleData,
    ).toEqual({ z: 1 });
  });

  it("rejects invalid kinds and variables", () => {
    const kind =
      (catalog: never[], name = "k") =>
      () =>
        defineTemplateKind({ kind: name, label: "K", catalog });
    expect(kind([], "Bad Kind")).toThrow(ConfigError);
    expect(kind([{ path: "a b", label: "x" }] as never[])).toThrow("Invalid path");
    expect(kind([{ path: "brand.x", label: "x" }] as never[])).toThrow("reserved");
    expect(kind([{ path: "a", label: "x", type: "date-time" }] as never[])).toThrow("Unknown type");
    expect(kind([{ path: "a", label: "x", type: "enum" }] as never[])).toThrow("needs `values`");
    expect(kind([{ path: "a", label: "x", type: "list" }] as never[])).toThrow("needs `fields`");
    expect(
      kind([
        { path: "a", label: "x" },
        { path: "a", label: "y" },
      ] as never[]),
    ).toThrow("twice");
  });
});

describe("plugin options", () => {
  it("rejects duplicate kinds and font keys", () => {
    expect(() => templates({ kinds: [letter, letter] })).toThrow("registered twice");
    const font = {
      key: "serif",
      label: "S",
      generic: "serif" as const,
      faces: () => Promise.resolve([]),
    };
    expect(() => resolveOptions({ kinds: [], fonts: [font] })).toThrow("font keys");
  });

  it("applies defaults", () => {
    const resolved = resolveOptions({ kinds: [letter], page: { size: "a4", reserveBottom: -5 } });
    expect(resolved.page).toEqual({ width: 595.28, height: 841.89, reserveBottom: 0 });
    expect(resolved.fontKeys).toEqual(["sans", "serif", "mono", "custom"]);
    expect(resolved.pdf).toBeNull();
    expect(resolved.format.locale).toBe("en-US");
  });
});
