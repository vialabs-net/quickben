import { describe, expect, it } from "vitest";

import { findBox, matchKey, pageTextItems, withBoxes } from "../src/extractors/text-boxes";

import type { TextItem } from "../src/extractors/text-boxes";

const item = (str: string, x0: number, y0 = 0.1, width = 0.4): TextItem => ({
  str,
  box: { x0, y0, x1: x0 + width, y1: y0 + 0.02 },
});

describe("matchKey", () => {
  it("keeps letters and digits, folded", () => {
    expect(matchKey("16.482.371-7")).toBe("164823717");
    expect(matchKey("Peñalolén")).toBe("PENALOLEN");
    expect(matchKey(" - ")).toBe("");
  });
});

describe("findBox", () => {
  it("maps expanded ligatures and letters back to the original text", () => {
    const items = [item("Oﬁcina Straße", 0.1), item("16.482.371-7", 0.1, 0.5)];
    expect(findBox(items, "16482371-7")?.text).toBe("16.482.371-7");
    expect(findBox(items, "STRASSE")?.text).toBe("Straße");
  });

  it("rejects part of a longer number split across contiguous runs", () => {
    const items = [
      item("1", 0.1, 0.1, 0.02),
      item("48213", 0.12, 0.1, 0.1),
      item("0", 0.22, 0.1, 0.02),
      item("48213", 0.1, 0.5, 0.1),
    ];
    expect(findBox(items, "48213")?.box.y0).toBe(0.5);
  });

  it("finds a value printed with separators and splits the item by characters", () => {
    // "ID: " is 4 of 16 characters; the value takes the remaining 12.
    const found = findBox([item("ID: 16.482.371-7", 0.1, 0.1, 0.32)], "16482371-7");
    expect(found?.text).toBe("16.482.371-7");
    expect(found?.box.x0).toBeCloseTo(0.18);
    expect(found?.box.x1).toBeCloseTo(0.42);
  });

  it("joins a value split over several items", () => {
    const found = findBox(
      [
        item("Customer:", 0.05, 0.2, 0.1),
        item("ANA", 0.2, 0.2, 0.06),
        item("SOTO", 0.27, 0.21, 0.08),
      ],
      "Ana Soto",
    );
    expect(found?.text).toBe("ANA SOTO");
    expect(found?.box.x0).toBeCloseTo(0.2);
    expect(found?.box.x1).toBeCloseTo(0.35);
    expect(found?.box.y1).toBeCloseTo(0.23);
  });

  it("skips matches inside a longer number and gives up when absent", () => {
    const items = [item("N 1482130", 0.1), item("Year 2024 N 48213", 0.1, 0.5)];
    expect(findBox(items, "48213")?.box.y0).toBe(0.5);
    expect(findBox(items, "99999")).toBeNull();
    expect(findBox(items, "--")).toBeNull();
  });
});

describe("withBoxes", () => {
  it("adds evidence from the first page that has the value", () => {
    const fields = withBoxes(
      { make: { value: "ACME", confidence: 1 }, code: { value: "ZZ999", confidence: 1 } },
      [
        { page: 1, items: [item("Make: x", 0.1)] },
        { page: 2, items: [item("ACME", 0.3)] },
      ],
    );
    expect(fields.make?.evidence).toMatchObject({ page: 2, text: "ACME" });
    expect(fields.code).toEqual({ value: "ZZ999", confidence: 1 });
  });
});

describe("pageTextItems", () => {
  it("converts item transforms to page fractions, skipping blank and rotated runs", async () => {
    const page = {
      getViewport: () => ({
        width: 600,
        height: 400,
        // PDF space has its origin at the bottom left.
        convertToViewportPoint: (x: number, y: number) => [x, 400 - y],
      }),
      getTextContent: () =>
        Promise.resolve({
          items: [
            { str: "ACME", transform: [10, 0, 0, 10, 60, 200], width: 120, height: 10 },
            { str: "NOHEIGHT", transform: [10, 0, 0, 10, 60, 100], width: 120 },
            { str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10 },
            { str: "no transform" },
            { type: "beginMarkedContent" },
            { str: "ROTATED", transform: [0, 10, -10, 0, 60, 200], width: 120, height: 10 },
            { str: "REVERSED", transform: [-10, 0, 0, -10, 60, 200], width: 120, height: 10 },
          ],
        }),
    };
    const items = await pageTextItems(page);
    expect(items.map((i) => i.str)).toEqual(["ACME", "NOHEIGHT"]);
    const [acme] = items;
    expect(acme?.box.x0).toBeCloseTo(0.1);
    expect(acme?.box.x1).toBeCloseTo(0.3);
    expect(acme?.box.y0).toBeCloseTo((400 - 209) / 400);
    expect(acme?.box.y1).toBeCloseTo((400 - 197.5) / 400);
  });
});
