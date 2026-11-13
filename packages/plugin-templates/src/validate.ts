import {
  ALIGNMENTS,
  BLOCK_NODES,
  INLINE_NODES,
  MARKS,
  plainText,
  textAttr,
  TRANSFORMS,
} from "./content";
import { checkExpression } from "./expression";

import type { TemplateIssue, TemplateNode } from "./content";
import type { CatalogVariable, ResolvedKind } from "./kinds";

/** Most rows or columns a table cell may span. */
export const MAX_SPAN = 12;
/** Longest page footer, in characters: about four lines. */
export const MAX_FOOTER_CHARS = 400;
/** Longest signature caption. */
export const MAX_CAPTION_CHARS = 80;

const blockNodes = new Set<string>(BLOCK_NODES);
const inlineNodes = new Set<string>(INLINE_NODES);
const marks = new Set<string>(MARKS);
const alignments = new Set<string>(ALIGNMENTS);
const transforms = new Set<string>(TRANSFORMS);

const nodeNames: Readonly<Record<string, string>> = {
  checkOption: "Checkbox option",
  checkMark: "Inline checkbox",
  conditional: "Conditional block",
};

const notInTable = new Set(["table", "pageFooter", "signature"]);

function validSpan(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SPAN)
  );
}

function hasSignature(node: TemplateNode): boolean {
  return node.type === "signature" || (node.content ?? []).some(hasSignature);
}

class Validator {
  readonly issues: TemplateIssue[] = [];

  constructor(private readonly catalog: readonly CatalogVariable[]) {}

  private add(path: number[], message: string): void {
    this.issues.push({ path, message });
  }

  private find(path: string): CatalogVariable | undefined {
    return this.catalog.find((v) => v.path === path);
  }

  private condition(node: TemplateNode, path: number[]): void {
    const expr = textAttr(node.attrs?.expr).trim();
    for (const message of checkExpression(expr, this.catalog)) {
      this.add(path, `${nodeNames[node.type] ?? node.type}: ${message}`);
    }
  }

  private variable(node: TemplateNode, path: number[]): void {
    const name = textAttr(node.attrs?.path);
    const variable = this.find(name);
    if (!variable) this.add(path, `Unknown variable "${name}"`);
    else if (variable.type === "list") {
      this.add(path, `"${variable.label}" is a list: show it with a repeated list`);
    }
    const transform = node.attrs?.transform;
    if (transform !== undefined && transform !== null && !transforms.has(textAttr(transform))) {
      this.add(path, "Unknown text transform");
    }
  }

  private inline(node: TemplateNode, path: number[]): void {
    if (!inlineNodes.has(node.type)) {
      this.add(path, `"${node.type}" cannot be inside a paragraph`);
      return;
    }
    for (const mark of node.marks ?? []) {
      if (!marks.has(mark.type)) this.add(path, `Formatting not allowed: ${mark.type}`);
    }
    if (node.type === "checkMark") this.condition(node, path);
    if (node.type === "variable") this.variable(node, path);
  }

  private inlines(node: TemplateNode, path: number[]): void {
    (node.content ?? []).forEach((child, i) => {
      this.inline(child, [...path, i]);
    });
  }

  blocks(node: TemplateNode, path: number[]): void {
    (node.content ?? []).forEach((child, i) => {
      this.block(child, [...path, i]);
    });
  }

  private table(node: TemplateNode, path: number[]): void {
    const rows = node.content ?? [];
    if (rows.length === 0) this.add(path, "The table has no rows");
    rows.forEach((row, r) => {
      if (row.type !== "tableRow") {
        this.add([...path, r], "A table contains rows only");
        return;
      }
      if (!row.content?.length) this.add([...path, r], "The row has no cells");
      (row.content ?? []).forEach((cell, c) => {
        const at = [...path, r, c];
        if (cell.type !== "tableCell" && cell.type !== "tableHeader") {
          this.add(at, "A row contains cells only");
          return;
        }
        if (!validSpan(cell.attrs?.colspan) || !validSpan(cell.attrs?.rowspan)) {
          this.add(at, "The cell spans too many rows or columns");
        }
        (cell.content ?? []).forEach((child, i) => {
          if (notInTable.has(child.type)) this.add([...at, i], "This block cannot be in a table");
          else this.block(child, [...at, i]);
        });
      });
    });
  }

  private repeat(node: TemplateNode, path: number[]): void {
    const name = textAttr(node.attrs?.list);
    const list = this.find(name);
    if (!list) this.add(path, `The repeated list uses "${name}", which is not a variable`);
    else if (list.type !== "list") this.add(path, `"${list.label}" is not a list`);
    const columns = Array.isArray(node.attrs?.columns)
      ? (node.attrs.columns as { field?: unknown }[])
      : [];
    if (columns.length === 0) this.add(path, "The repeated list needs at least one column");
    for (const column of columns) {
      if (list?.fields && !list.fields.some((f) => f.key === column.field)) {
        this.add(path, `"${list.label}" has no field "${textAttr(column.field)}"`);
      }
    }
  }

  private list(node: TemplateNode, path: number[]): void {
    (node.content ?? []).forEach((item, i) => {
      if (item.type === "listItem") this.blocks(item, [...path, i]);
      else this.add([...path, i], "A list contains list items only");
    });
  }

  private footer(node: TemplateNode, path: number[]): void {
    if (path.length !== 1) this.add(path, "The page footer goes at the top level of the document");
    this.inlines(node, path);
    if (plainText(node).length > MAX_FOOTER_CHARS) {
      this.add(path, `The page footer is too long: at most ${String(MAX_FOOTER_CHARS)} characters`);
    }
  }

  private block(node: TemplateNode, path: number[]): void {
    if (!blockNodes.has(node.type)) {
      this.add(path, `Block not allowed: ${node.type}`);
      return;
    }
    const align = node.attrs?.textAlign;
    if (align !== undefined && align !== null && !alignments.has(textAttr(align))) {
      this.add(path, "Unknown alignment");
    }
    switch (node.type) {
      case "paragraph":
      case "heading":
        this.inlines(node, path);
        break;
      case "checkOption":
        this.condition(node, path);
        this.inlines(node, path);
        break;
      case "conditional":
        this.condition(node, path);
        this.blocks(node, path);
        break;
      case "blockquote":
        this.blocks(node, path);
        break;
      case "bulletList":
      case "orderedList":
        this.list(node, path);
        break;
      case "repeat":
        this.repeat(node, path);
        break;
      case "signature":
        if (textAttr(node.attrs?.caption).length > MAX_CAPTION_CHARS) {
          this.add(path, "The signature caption is too long");
        }
        this.inlines(node, path);
        break;
      case "table":
        this.table(node, path);
        break;
      case "pageFooter":
        this.footer(node, path);
        break;
      default:
        // horizontalRule, pageBreak: no content.
        break;
    }
  }
}

/**
 * Every problem that blocks publishing: unknown nodes, marks and attributes, unknown
 * variables, invalid conditions and repeated lists. Each issue points at a node by its path.
 */
export function validateContent(doc: TemplateNode, kind: ResolvedKind): TemplateIssue[] {
  const validator = new Validator(kind.catalog);
  validator.blocks(doc, []);
  const issues = validator.issues;
  const footers = (doc.content ?? []).filter((node) => node.type === "pageFooter").length;
  if (footers > 1) issues.push({ path: [], message: "Keep one page footer" });
  if (kind.requireSignature && !hasSignature(doc)) {
    issues.push({ path: [], message: "Add a signature block" });
  }
  return issues;
}
