import { describe, expect, it } from "vitest";

import { validateContent } from "../src";
import { resolveKind } from "../src/kinds";

import { doc, invoice, letter, p, signature, text, v } from "./fixtures";

import type { TemplateNode } from "../src";

const kind = resolveKind(invoice);
const check = (...nodes: TemplateNode[]) => validateContent(doc(...nodes, signature), kind);

describe("validateContent", () => {
  it("passes the base template", () => {
    expect(validateContent(invoice.baseTemplate, kind)).toEqual([]);
  });

  it("points at unknown variables with the path of the node", () => {
    expect(check(p(text("Hi "), v("customer.age")))).toEqual([
      { path: [0, 1], message: 'Unknown variable "customer.age"' },
    ]);
  });

  it("asks for a list variable to go in a repeated list", () => {
    expect(check(p(v("invoice.lines")))[0]?.message).toContain("repeated list");
  });

  it("checks transforms, marks and alignment", () => {
    const issues = check(
      p(v("customer.name", { transform: "camel" })),
      p({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:x" } }] }),
      { type: "paragraph", attrs: { textAlign: "evil" }, content: [] },
      p(v("customer.name", { transform: "upper" }), { type: "hardBreak" }),
    );
    expect(issues.map((i) => i.message)).toEqual([
      "Unknown text transform",
      "Formatting not allowed: link",
      "Unknown alignment",
    ]);
  });

  it("checks conditions of options, conditional blocks and inline boxes", () => {
    const issues = check(
      { type: "checkOption", attrs: { expr: "customer.type == 'x'" }, content: [] },
      { type: "conditional", attrs: { expr: "customer.age" }, content: [p()] },
      p(text("is "), { type: "checkMark", attrs: { expr: "" } }),
      { type: "checkOption", attrs: { expr: "invoice.paid" }, content: [text("Paid")] },
    );
    expect(issues.map((i) => i.path)).toEqual([[0], [1], [2, 1]]);
    expect(issues[0]?.message).toContain("Checkbox option");
    expect(issues[1]?.message).toContain("Conditional block: Unknown variable");
    expect(issues[2]?.message).toBe("Inline checkbox: Write a condition");
  });

  it("checks repeated lists against list variables and their fields", () => {
    const repeat = (attrs: Record<string, unknown>): TemplateNode => ({ type: "repeat", attrs });
    const issues = check(
      repeat({ list: "customer.name", columns: [{ field: "item" }] }),
      repeat({ list: "invoice.lines", columns: [{ field: "age" }] }),
      repeat({ list: "invoice.lines", columns: [] }),
      repeat({ list: "nothing", columns: "x" }),
    );
    expect(issues.map((i) => i.message)).toEqual([
      '"Customer name" is not a list',
      '"Lines" has no field "age"',
      "The repeated list needs at least one column",
      'The repeated list uses "nothing", which is not a variable',
      "The repeated list needs at least one column",
    ]);
  });

  it("rejects nodes outside the schema", () => {
    const issues = check(
      { type: "codeBlock", content: [] },
      v("customer.name"),
      p({ type: "image" }),
      { type: "bulletList", content: [p()] },
      { type: "orderedList", content: [{ type: "listItem", content: [p(v("x"))] }] },
      { type: "blockquote", content: [{ type: "table", content: [] }] },
      { type: "horizontalRule" },
      { type: "pageBreak" },
      { type: "heading", content: [text("h")] },
    );
    expect(issues.map((i) => i.message)).toEqual([
      "Block not allowed: codeBlock",
      "Block not allowed: variable",
      '"image" cannot be inside a paragraph',
      "A list contains list items only",
      'Unknown variable "x"',
      "The table has no rows",
    ]);
  });

  it("checks tables: rows, cells, spans and blocks inside", () => {
    const cell = (type: string, ...content: TemplateNode[]): TemplateNode => ({
      type,
      attrs: { colspan: 1, rowspan: 1 },
      content: content.length > 0 ? content : [p()],
    });
    const row = (...cells: TemplateNode[]): TemplateNode => ({ type: "tableRow", content: cells });
    const ok = { type: "table", content: [row(cell("tableHeader")), row(cell("tableCell"))] };
    expect(check(ok)).toEqual([]);
    const bad = {
      type: "table",
      content: [
        row(cell("paragraph")),
        row({ type: "tableCell", attrs: { colspan: 99 }, content: [p()] }),
        row(cell("tableCell", signature)),
        p(),
        { type: "tableRow", content: [] },
      ],
    };
    expect(check(bad).map((i) => i.path)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0, 0],
      [0, 3],
      [0, 4],
    ]);
  });

  it("allows one short page footer at the top level", () => {
    const footer = (value: string): TemplateNode => ({
      type: "pageFooter",
      content: [text(value)],
    });
    expect(check(p(), footer("Confidential"))).toEqual([]);
    expect(check(footer("a"), footer("b")).map((i) => i.message)).toEqual(["Keep one page footer"]);
    expect(check({ type: "blockquote", content: [footer("a")] })[0]?.path).toEqual([0, 0]);
    expect(check(footer("x".repeat(401)))[0]?.message).toContain("too long");
  });

  it("checks the signature caption and requires a signature when the kind says so", () => {
    expect(check({ type: "signature", attrs: { caption: "x".repeat(81) } })[0]?.message).toContain(
      "caption",
    );
    expect(validateContent(doc(p()), kind)).toEqual([
      { path: [], message: "Add a signature block" },
    ]);
    expect(validateContent(doc(p()), resolveKind(letter))).toEqual([]);
  });
});
