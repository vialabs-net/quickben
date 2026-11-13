import { ValidationError } from "@quickben/core";
import { describe, expect, it } from "vitest";

import { asContent, contentHash, emptyContent, usedPaths } from "../src";
import { plainText } from "../src/content";

import { doc, p, text, v } from "./fixtures";

describe("asContent", () => {
  it("accepts only a document", () => {
    expect(() => asContent({ type: "paragraph" })).toThrow(ValidationError);
    expect(() => asContent("<p>x</p>")).toThrow("not a document");
    expect(() => asContent(null)).toThrow("not a document");
    expect(asContent(doc(p()))).toEqual(doc(p()));
    expect(asContent(emptyContent())).toEqual(emptyContent());
  });

  it("checks node, text, attribute, mark and column types", () => {
    expect(() => asContent(doc({ type: 3 } as never))).toThrow("Invalid node");
    expect(() => asContent(doc({ type: "text", text: 3 } as never))).toThrow("Invalid text");
    expect(() => asContent(doc({ type: "p", attrs: [] } as never))).toThrow("Invalid attributes");
    expect(asContent(doc({ type: "p", attrs: null } as never)).content[0]).toEqual({
      type: "p",
      attrs: null,
    });
    expect(() => asContent(doc({ type: "p", content: {} } as never))).toThrow("Invalid content");
    expect(() => asContent(doc({ type: "p", marks: {} } as never))).toThrow("Invalid marks");
    expect(() => asContent(doc({ type: "p", marks: [{ type: 1 }] } as never))).toThrow(
      "Invalid mark",
    );
    expect(() =>
      asContent(doc({ type: "p", marks: [{ type: "bold", attrs: 1 }] } as never)),
    ).toThrow("Invalid mark");
    expect(() => asContent(doc({ type: "repeat", attrs: { columns: {} } }))).toThrow(
      "Invalid columns",
    );
    expect(() => asContent(doc({ type: "repeat", attrs: { columns: [{ field: 1 }] } }))).toThrow(
      "Invalid columns",
    );
    expect(() =>
      asContent(doc({ type: "repeat", attrs: { columns: [{ field: "a", header: 1 }] } })),
    ).toThrow("Invalid columns");
  });

  it("refuses content too deep or too large", () => {
    let node = p();
    for (let i = 0; i < 40; i += 1) node = { type: "blockquote", content: [node] };
    expect(() => asContent(doc(node))).toThrow("too deeply");
    expect(() => asContent(doc(p(text("x".repeat(300_000)))))).toThrow("too large");
  });
});

describe("contentHash, usedPaths and plainText", () => {
  it("does not depend on key order", async () => {
    expect(await contentHash({ type: "doc", content: [] })).toBe(
      await contentHash({ content: [], type: "doc" }),
    );
    expect(await contentHash(doc(p()))).not.toBe(await contentHash(doc()));
    expect(await contentHash({ type: "doc", attrs: { a: undefined } })).toBe(
      await contentHash({ type: "doc", attrs: {} }),
    );
  });

  it("lists variables and lists", () => {
    const content = doc(p(v("a.b"), v("a.b"), v("c")), {
      type: "repeat",
      attrs: { list: "items" },
    });
    expect(usedPaths(content)).toEqual(["a.b", "c", "items"]);
  });

  it("prints text with variable paths", () => {
    expect(plainText(p(text("Hi "), v("name"), { type: "hardBreak" }))).toBe("Hi {name}");
    expect(plainText({ type: "text" })).toBe("");
  });
});
