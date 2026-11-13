import { describe, expect, it } from "vitest";

import { lookup } from "../src";
import { BLANK, display, itemText, listItems, resolveFormat } from "../src/values";

import type { CatalogVariable } from "../src";

const format = resolveFormat();
const variable = (
  type: CatalogVariable["type"],
  extra: Partial<CatalogVariable> = {},
): CatalogVariable => ({
  path: "x",
  label: "X",
  group: "Data",
  type,
  ...extra,
});

describe("lookup", () => {
  it("reads nested own properties and flat keys", () => {
    const data = { a: { b: { c: 1 } }, "a.flat": 2, list: [1] };
    expect(lookup(data, "a.b.c")).toBe(1);
    expect(lookup(data, "a.flat")).toBe(2);
    expect(lookup(data, "a.missing.c")).toBeUndefined();
    expect(lookup(data, "list.length")).toBeUndefined();
    expect(lookup(data, "constructor")).toBeUndefined();
    expect(lookup(data, "a.b.toString")).toBeUndefined();
  });
});

describe("display", () => {
  it("prints the placeholder for missing values and lists", () => {
    expect(display(variable("text"), null, format)).toBe(BLANK);
    expect(display(variable("text"), "", format)).toBe(BLANK);
    expect(display(variable("text", { placeholder: "n/a" }), undefined, format)).toBe("n/a");
    expect(display(variable("text"), ["a"], format)).toBe(BLANK);
    expect(display(variable("text"), { a: 1 }, format)).toBe(BLANK);
    expect(display(undefined, null, format)).toBe(BLANK);
  });

  it("formats by type and locale", () => {
    const values = [{ value: "a", label: "Alpha" }];
    expect(display(variable("enum", { values }), "a", format)).toBe("Alpha");
    expect(display(variable("enum", { values }), "b", format)).toBe("b");
    expect(display(variable("enum", { values }), true, format)).toBe(BLANK);
    expect(display(variable("number"), 1234.5, format)).toBe("1,234.5");
    expect(display(variable("number"), "12", format)).toBe("12");
    expect(display(variable("number"), true, format)).toBe(BLANK);
    expect(display(variable("number"), 1234.5, resolveFormat({ locale: "de-DE" }))).toBe("1.234,5");
    expect(display(variable("date"), "2026-11-06", format)).toBe("November 6, 2026");
    expect(
      display(variable("date"), "2026-11-06T23:30:00Z", resolveFormat({ timeZone: "Asia/Tokyo" })),
    ).toBe("November 7, 2026");
    expect(display(variable("date"), new Date("2026-01-02T00:00:00Z"), format)).toBe(
      "January 2, 2026",
    );
    expect(display(variable("date"), 0, format)).toBe("January 1, 1970");
    expect(display(variable("date"), "not a date", format)).toBe("not a date");
    expect(display(variable("date"), true, format)).toBe(BLANK);
    expect(display(variable("boolean"), true, format)).toBe("yes");
    expect(
      display(variable("boolean"), false, resolveFormat({ booleanLabels: ["sí", "no"] })),
    ).toBe("no");
    expect(display(variable("text"), new Date("2026-01-02T00:00:00Z"), format)).toBe(
      "January 2, 2026",
    );
    expect(display(variable("text"), 10n, format)).toBe("10");
    expect(display(variable("text"), 5, format, (value) => `#${String(value)}`)).toBe("#5");
  });
});

describe("list items", () => {
  it("keeps objects and prints fields", () => {
    expect(listItems("x")).toEqual([]);
    expect(listItems([{ a: 1 }, null, [1], "x"])).toEqual([{ a: 1 }]);
    expect(itemText({ a: 1, b: null, c: [1], d: true }, "a", format)).toBe("1");
    expect(itemText({ a: 1 }, "b", format)).toBe("");
    expect(itemText({ b: null }, "b", format)).toBe("");
    expect(itemText({ c: [1] }, "c", format)).toBe("");
    expect(itemText({ d: true }, "d", format)).toBe("yes");
  });
});
