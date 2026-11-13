import { ValidationError } from "@quickben/core";

/** A mark on text: bold, italic or underline. */
export interface TemplateMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A node of template content. The JSON of the TipTap (ProseMirror) editor. */
export interface TemplateNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TemplateNode[];
  text?: string;
  marks?: TemplateMark[];
}

/** Template content: a `doc` node. */
export interface TemplateContent extends TemplateNode {
  type: "doc";
  content: TemplateNode[];
}

/** A problem in template content. `path` holds child indexes from the root: `[2, 0]`. */
export interface TemplateIssue {
  path: number[];
  message: string;
}

/** Block nodes a template may use. */
export const BLOCK_NODES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "horizontalRule",
  "checkOption",
  "conditional",
  "repeat",
  "pageBreak",
  "signature",
  "table",
  "pageFooter",
] as const;

/** Inline nodes a template may use. */
export const INLINE_NODES = ["text", "variable", "checkMark", "hardBreak"] as const;
/** Text marks a template may use. */
export const MARKS = ["bold", "italic", "underline"] as const;
/** Text alignments. */
export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
/** Variable transforms. */
export const TRANSFORMS = ["lower", "upper"] as const;

/** Largest content, as JSON. */
export const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_DEPTH = 24;

/** A string attribute, or `""`: other types never turn into `[object Object]`. */
export const textAttr = (value: unknown): string => (typeof value === "string" ? value : "");

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ValidationError([{ path: "content", message }]);
}

function checkMarks(marks: unknown): void {
  if (marks === undefined) return;
  if (!Array.isArray(marks)) fail("Invalid marks");
  for (const mark of marks) {
    if (!record(mark) || typeof mark.type !== "string") fail("Invalid mark");
    if (mark.attrs !== undefined && !record(mark.attrs)) fail("Invalid mark");
  }
}

function checkColumns(columns: unknown): void {
  if (columns === undefined) return;
  if (!Array.isArray(columns)) fail("Invalid columns");
  for (const column of columns) {
    if (!record(column) || typeof column.field !== "string") fail("Invalid columns");
    if (column.header !== undefined && typeof column.header !== "string") fail("Invalid columns");
  }
}

function checkNode(raw: unknown, level: number): void {
  if (level > MAX_DEPTH) fail("The content is nested too deeply");
  if (!record(raw) || typeof raw.type !== "string") fail("Invalid node");
  if (raw.text !== undefined && typeof raw.text !== "string") fail("Invalid text");
  // Some editors send `attrs: null` for nodes without attributes.
  if (raw.attrs !== undefined && raw.attrs !== null && !record(raw.attrs))
    fail("Invalid attributes");
  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) fail("Invalid content");
    for (const child of raw.content) checkNode(child, level + 1);
  }
  checkMarks(raw.marks);
  if (record(raw.attrs)) checkColumns(raw.attrs.columns);
}

/**
 * Check the outer shape of content from a client: a `doc`, not too large or deep, with the
 * right JSON types. Returns a copy. Throws `ValidationError` (path `content`).
 *
 * The node types and attributes are checked by {@link validateContent}, which reports issues
 * instead of throwing, so a draft can be saved with problems.
 */
export function asContent(raw: unknown): TemplateContent {
  if (!record(raw) || raw.type !== "doc" || !Array.isArray(raw.content)) {
    fail("The content is not a document");
  }
  const json = JSON.stringify(raw);
  if (new TextEncoder().encode(json).length > MAX_CONTENT_BYTES) fail("The content is too large");
  checkNode(raw, 0);
  return JSON.parse(json) as TemplateContent;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort((a, b) => (a < b ? -1 : 1))
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** SHA-256 of the content, independent of key order. Hex. */
export async function contentHash(content: TemplateNode): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(content)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Variable and list paths the content uses. */
export function usedPaths(doc: TemplateNode): string[] {
  const paths = new Set<string>();
  const visit = (node: TemplateNode) => {
    if (node.type === "variable" && typeof node.attrs?.path === "string") {
      paths.add(node.attrs.path);
    }
    if (node.type === "repeat" && typeof node.attrs?.list === "string") {
      paths.add(node.attrs.list);
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return [...paths];
}

/** Plain text of a node, with `{path}` for variables. */
export function plainText(node: TemplateNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "variable") return `{${textAttr(node.attrs?.path)}}`;
  return (node.content ?? []).map(plainText).join("");
}

/** An empty document. */
export function emptyContent(): TemplateContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
