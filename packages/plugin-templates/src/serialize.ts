/**
 * Template content to HTML. Every string from the content or the data is escaped, and
 * attributes come from fixed lists. Unknown nodes and marks print nothing, so a template can
 * never inject markup.
 */
import { isHexColor } from "./brand";
import { ALIGNMENTS, MARKS, textAttr, TRANSFORMS } from "./content";
import { test } from "./expression";
import { BLANK, display, itemText, listItems, lookup } from "./values";

import type { BrandRender } from "./brand";
import type { TemplateNode } from "./content";
import type { ResolvedKind } from "./kinds";
import type { ResolvedFormat, TemplateData } from "./values";

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML content and attribute values. */
export const escapeHtml = (text: string): string =>
  text.normalize("NFC").replaceAll(/[&<>"']/g, (c) => escapes[c] ?? c);

/** What a render reads besides the content. */
export interface RenderContext {
  kind: ResolvedKind;
  data: TemplateData;
  format: ResolvedFormat;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function withMarks(html: string, node: TemplateNode): string {
  let out = html;
  for (const mark of node.marks ?? []) {
    const type = pick(mark.type, MARKS);
    if (type === "bold") out = `<strong>${out}</strong>`;
    else if (type === "italic") out = `<em>${out}</em>`;
    else if (type === "underline") out = `<u>${out}</u>`;
  }
  return out;
}

function variable(node: TemplateNode, ctx: RenderContext): string {
  const path = textAttr(node.attrs?.path);
  const def = ctx.kind.catalog.find((v) => v.path === path);
  if (!def) return `<span class="unknown">[${escapeHtml(path || "variable")}]</span>`;
  const value = lookup(ctx.data, path);
  let text = display(def, value, ctx.format, ctx.kind.formats.get(path));
  const transform = pick(node.attrs?.transform, TRANSFORMS);
  const missing = text === BLANK || text === def.placeholder;
  if (!missing && transform === "lower") text = text.toLocaleLowerCase(ctx.format.locale);
  if (!missing && transform === "upper") text = text.toLocaleUpperCase(ctx.format.locale);
  return withMarks(`<span class="var">${escapeHtml(text)}</span>`, node);
}

const CHECK =
  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2 4.1 7.4 8.4 2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A box inside a sentence. */
function checkMark(node: TemplateNode, ctx: RenderContext): string {
  const checked = test(textAttr(node.attrs?.expr), ctx.data);
  return `<span class="ibox${checked ? " checked" : ""}">${checked ? CHECK : ""}</span>`;
}

function inline(nodes: TemplateNode[] | undefined, ctx: RenderContext): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case "text":
          return withMarks(escapeHtml(node.text ?? ""), node);
        case "variable":
          return variable(node, ctx);
        case "checkMark":
          return checkMark(node, ctx);
        case "hardBreak":
          return "<br>";
        default:
          return "";
      }
    })
    .join("");
}

function alignClass(node: TemplateNode): string {
  const align = pick(node.attrs?.textAlign, ALIGNMENTS);
  return align ? ` class="a-${align}"` : "";
}

function spanAttr(name: string, value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) && value > 1 && value <= 12
    ? ` ${name}="${String(value)}"`
    : "";
}

/** A fixed table: headers, cells and blank rows to fill in by hand. */
function table(node: TemplateNode, ctx: RenderContext): string {
  const rows = (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map((row) => {
      const cells = (row.content ?? [])
        .filter((cell) => cell.type === "tableCell" || cell.type === "tableHeader")
        .map((cell) => {
          const tag = cell.type === "tableHeader" ? "th" : "td";
          const spans =
            spanAttr("colspan", cell.attrs?.colspan) + spanAttr("rowspan", cell.attrs?.rowspan);
          return `<${tag}${spans}>${renderBlocks(cell.content, ctx)}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="grid"><tbody>${rows}</tbody></table>`;
}

interface Column {
  field: string;
  header: string;
}

function columnsOf(node: TemplateNode): Column[] {
  const raw = Array.isArray(node.attrs?.columns) ? (node.attrs.columns as unknown[]) : [];
  return raw
    .map((column) => {
      const c = (column ?? {}) as { field?: unknown; header?: unknown };
      return { field: textAttr(c.field), header: textAttr(c.header) };
    })
    .filter((column) => column.field !== "");
}

/** One row (or bullet) per item of a list variable. */
function repeat(node: TemplateNode, ctx: RenderContext): string {
  const items = listItems(lookup(ctx.data, textAttr(node.attrs?.list)));
  const columns = columnsOf(node);
  if (items.length === 0) {
    return node.attrs?.empty === "hide" ? "" : `<p><strong>${BLANK}</strong></p>`;
  }
  const cell = (item: Record<string, unknown>, field: string) =>
    escapeHtml(itemText(item, field, ctx.format));
  if (node.attrs?.display === "bullets") {
    const rows = items
      .map((item) => `<li>${columns.map((c) => cell(item, c.field)).join(", ")}</li>`)
      .join("");
    return `<ul class="repeat">${rows}</ul>`;
  }
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const row = (item: Record<string, unknown>) =>
    columns.map((c) => `<td>${cell(item, c.field)}</td>`).join("");
  const rows = items.map((item) => `<tr>${row(item)}</tr>`).join("");
  return `<table class="repeat"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** A signature line, its caption and the lines under it (text and variables). */
function signature(node: TemplateNode, ctx: RenderContext): string {
  const caption = textAttr(node.attrs?.caption).trim() || "Signature";
  const lines = inline(node.content, ctx);
  return (
    '<div class="signature"><div class="sig-line"></div>' +
    `<div class="sig-caption">${escapeHtml(caption)}</div>` +
    (lines ? `<div class="sig-lines">${lines}</div>` : "") +
    "</div>"
  );
}

function checkOption(node: TemplateNode, ctx: RenderContext): string {
  const checked = test(textAttr(node.attrs?.expr), ctx.data);
  const box = `<span class="box${checked ? " checked" : ""}">${checked ? CHECK : ""}</span>`;
  return `<div class="option">${box}<p${alignClass(node)}>${inline(node.content, ctx)}</p></div>`;
}

function list(node: TemplateNode, ctx: RenderContext): string {
  const tag = node.type === "bulletList" ? "ul" : "ol";
  const items = (node.content ?? [])
    .filter((item) => item.type === "listItem")
    .map((item) => `<li>${renderBlocks(item.content, ctx)}</li>`)
    .join("");
  const start = node.attrs?.start;
  const startAttr =
    tag === "ol" && typeof start === "number" && Number.isSafeInteger(start) && start !== 1
      ? ` start="${String(start)}"`
      : "";
  return `<${tag}${startAttr}>${items}</${tag}>`;
}

function paragraph(node: TemplateNode, ctx: RenderContext): string {
  const align = pick(node.attrs?.textAlign, ALIGNMENTS);
  const classes = [node.attrs?.variant === "note" ? "note" : "", align ? `a-${align}` : ""]
    .filter(Boolean)
    .join(" ");
  const body = inline(node.content, ctx);
  const classAttr = classes ? ` class="${classes}"` : "";
  return `<p${classAttr}>${body || "<br>"}</p>`;
}

function block(node: TemplateNode, ctx: RenderContext): string {
  switch (node.type) {
    case "paragraph":
      return paragraph(node, ctx);
    case "heading": {
      const level = [1, 2, 3].includes(Number(node.attrs?.level)) ? Number(node.attrs?.level) : 1;
      return `<h${String(level)}${alignClass(node)}>${inline(node.content, ctx)}</h${String(level)}>`;
    }
    case "blockquote":
      return `<blockquote>${renderBlocks(node.content, ctx)}</blockquote>`;
    case "bulletList":
    case "orderedList":
      return list(node, ctx);
    case "horizontalRule":
      return "<hr>";
    case "checkOption":
      return checkOption(node, ctx);
    case "conditional":
      return test(textAttr(node.attrs?.expr), ctx.data) ? renderBlocks(node.content, ctx) : "";
    case "repeat":
      return repeat(node, ctx);
    case "pageBreak":
      return '<div class="page-break"></div>';
    case "signature":
      return signature(node, ctx);
    case "table":
      return table(node, ctx);
    default:
      // pageFooter is printed by the letterhead: see footerHtml.
      return "";
  }
}

/** Blocks to HTML. */
export function renderBlocks(nodes: TemplateNode[] | undefined, ctx: RenderContext): string {
  return (nodes ?? []).map((node) => block(node, ctx)).join("");
}

/** The template's own page footer as inline HTML, or `null` to print the brand's. */
export function footerHtml(doc: TemplateNode, ctx: RenderContext): string | null {
  const footer = (doc.content ?? []).find((node) => node.type === "pageFooter");
  if (!footer) return null;
  const html = inline(footer.content, ctx);
  return html.trim() ? html : null;
}

/* Page geometry, in points. */

/** Page sizes. */
export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;

/** Page options of a render. */
export interface PageOptions {
  /** Default `letter`. */
  size?: keyof typeof PAGE_SIZES;
  /** Empty space kept at the bottom of every page, in points, e.g. for a signature stamp. */
  reserveBottom?: number;
}

/** Page options with defaults. */
export interface ResolvedPage {
  width: number;
  height: number;
  reserveBottom: number;
}

export function resolvePage(options: PageOptions = {}): ResolvedPage {
  const size = PAGE_SIZES[options.size ?? "letter"];
  return { ...size, reserveBottom: Math.max(0, options.reserveBottom ?? 0) };
}

const MARGIN_X = 64;
const HEADER_TOP = 30;
const CONTENT_TOP = 100;
const FOOTER_HEIGHT = 28;
/** A template's own footer has room for four lines. */
const TALL_FOOTER_HEIGHT = 46;
const INK = "#121826";
const MUTED = "#6b7280";
const RULE = "#d1d5db";

const pt = (value: number) => `${String(value)}pt`;

function fontCss(brand: BrandRender): string {
  return brand.faces
    .map(
      (face) =>
        `@font-face{font-family:"Brand";font-weight:${String(face.weight)};font-style:${face.style};src:url(${face.url}) format("woff2");}`,
    )
    .join("");
}

const color = (value: string, fallback: string) => (isHexColor(value) ? value : fallback);

function baseCss(brand: BrandRender): string {
  const family = brand.faces.length > 0 ? `"Brand",${brand.stack}` : brand.stack;
  return `${fontCss(brand)}
html{font-family:${family};font-size:10pt;line-height:1.42;color:${INK};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;}
*{box-sizing:border-box;}`;
}

function documentCss(primary: string): string {
  return `
p,h1,h2,h3{white-space:pre-wrap;}
p{margin:0 0 8pt;text-align:justify;orphans:2;widows:2;}
p.note{font-size:7.5pt;line-height:1.4;color:${MUTED};margin-bottom:4pt;}
h1,h2,h3{color:${primary};font-weight:700;margin:0;break-after:avoid;}
h1{font-size:14pt;line-height:1.3;text-align:center;margin-bottom:14pt;}
h2{font-size:12pt;line-height:1.35;margin:6pt 0 8pt;}
h3{font-size:10pt;margin:4pt 0 6pt;}
.a-left{text-align:left;}.a-center{text-align:center;}.a-right{text-align:right;}.a-justify{text-align:justify;}
blockquote{margin:0 0 12pt 18pt;padding:0;color:${MUTED};}
ul,ol{margin:0 0 8pt;padding-left:18pt;}
li{margin:0 0 4pt;}
li>p{margin:0;text-align:left;}
hr{border:0;border-top:.5pt solid ${RULE};margin:10pt 0;}
.option{display:flex;gap:11pt;margin:0 0 10pt;break-inside:avoid;}
.option>p{margin:0;flex:1;}
.box{flex:none;width:9pt;height:9pt;margin-top:2.6pt;border:.8pt solid ${INK};color:${INK};display:block;}
.ibox{display:inline-block;width:8.5pt;height:8.5pt;margin:0 1.5pt;border:.8pt solid ${INK};color:${INK};vertical-align:-1pt;}
.box svg,.ibox svg{display:block;width:100%;height:100%;}
table.grid,table.repeat{width:100%;border-collapse:collapse;margin:0 0 12pt;font-size:9.5pt;line-height:1.3;}
table.grid th,table.grid td{border:.5pt solid ${INK};padding:4pt 6pt;vertical-align:top;text-align:left;height:18pt;}
table.grid th{font-weight:700;}
table.grid p{margin:0;text-align:left;}
table.repeat th{text-align:left;color:${MUTED};font-weight:700;padding:5pt 6pt;border-top:.5pt solid ${RULE};border-bottom:.5pt solid ${RULE};}
table.repeat td{padding:5pt 6pt;border-bottom:.5pt solid ${RULE};}
tr{break-inside:avoid;}
ul.repeat li{text-align:left;}
.page-break{break-after:page;height:0;}
.signature{break-inside:avoid;width:220pt;margin:40pt auto 8pt;text-align:center;font-size:9.5pt;line-height:1.4;}
.sig-line{border-top:.7pt solid ${INK};margin-bottom:5pt;}
.sig-caption{font-weight:700;}
.unknown{color:#b91c1c;font-weight:700;}`;
}

function contentBottom(page: ResolvedPage, tallFooter: boolean): number {
  return page.reserveBottom + (tallFooter ? TALL_FOOTER_HEIGHT : FOOTER_HEIGHT) + 10;
}

/** Parameters of the page builders. */
export interface PageParams {
  brand: BrandRender;
  page: ResolvedPage;
  title: string;
  /** `lang` of the HTML document. */
  lang: string;
}

function head(params: PageParams, css: string): string {
  return `<!doctype html><html lang="${escapeHtml(params.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(params.title)}</title><style>${baseCss(params.brand)}${css}</style></head>`;
}

/**
 * The printable document body. Page margins leave room for the letterhead, which the PDF
 * renderer draws on every page. `tallFooter`: the template has its own, longer footer.
 */
export function documentHtml(params: PageParams & { body: string; tallFooter: boolean }): string {
  const { page } = params;
  const margin = `${pt(CONTENT_TOP)} ${pt(MARGIN_X)} ${pt(contentBottom(page, params.tallFooter))} ${pt(MARGIN_X)}`;
  const css = `@page{size:${pt(page.width)} ${pt(page.height)};margin:${margin};}${documentCss(color(params.brand.primaryColor, INK))}`;
  return `${head(params, css)}<body>${params.body}</body></html>`;
}

interface FrameParts {
  header: string;
  footer: string;
}

function frameParts(
  brand: BrandRender,
  footer: string | null,
  reference: string | null,
): FrameParts {
  const logo = brand.logo ? `<img class="logo" src="${escapeHtml(brand.logo)}" alt="">` : "";
  const name = brand.legalName ?? brand.displayName ?? "";
  const idLine = [brand.taxId, brand.address]
    .filter((part): part is string => Boolean(part))
    .map(escapeHtml)
    .join(" · ");
  // Without a logo the display name is already on the left.
  const whoName = (logo || brand.legalName) && name ? `<strong>${escapeHtml(name)}</strong>` : "";
  const who =
    whoName +
    (idLine ? `<div>${idLine}</div>` : "") +
    (brand.contact ? `<div>${escapeHtml(brand.contact)}</div>` : "");
  const left =
    logo ||
    (brand.displayName
      ? `<div class="brandname">${escapeHtml(brand.displayName)}</div>`
      : "<div></div>");
  // The template's footer is HTML escaped by inline(); the brand's is plain text.
  const footerLeft = footer ?? escapeHtml(brand.footer ?? "");
  const whoBlock = who ? `<div class="who">${who}</div>` : "";
  return {
    header: `<div class="header">${left}${whoBlock}</div>`,
    footer: `<div class="footer"><div class="left">${footerLeft}</div><div class="right">${escapeHtml(reference ?? "")}</div></div>`,
  };
}

function frameCss(brand: BrandRender): string {
  const primary = color(brand.primaryColor, INK);
  const accent = color(brand.accentColor, primary);
  return `
.header{display:flex;align-items:center;justify-content:space-between;gap:16pt;border-bottom:1.5pt solid ${accent};padding-bottom:8pt;}
.logo{max-height:40pt;max-width:170pt;object-fit:contain;display:block;}
.brandname{font-size:13pt;font-weight:700;color:${primary};line-height:1.2;}
.who{text-align:right;font-size:7.5pt;line-height:1.45;color:${MUTED};max-width:300pt;}
.who strong{display:block;font-size:8.5pt;color:${primary};}
.footer{border-top:.5pt solid ${RULE};padding-top:6pt;display:flex;justify-content:space-between;gap:16pt;font-size:7pt;line-height:1.4;color:${MUTED};overflow:hidden;}
.footer .left{flex:1;max-width:390pt;white-space:pre-wrap;}
.footer .left .ibox{display:inline-block;width:6.5pt;height:6.5pt;border:.6pt solid ${MUTED};vertical-align:-.5pt;}
.footer .right{text-align:right;white-space:nowrap;}`;
}

/**
 * The letterhead and footer alone on one transparent page. The PDF renderer draws it over
 * every page of the document.
 */
export function frameHtml(
  params: PageParams & { footer: string | null; reference: string | null },
): string {
  const { page } = params;
  const parts = frameParts(params.brand, params.footer, params.reference);
  const footerHeight = params.footer ? TALL_FOOTER_HEIGHT : FOOTER_HEIGHT;
  const css = `@page{size:${pt(page.width)} ${pt(page.height)};margin:0;}
html,body{background:transparent;}
.page{position:relative;width:${pt(page.width)};height:${pt(page.height)};overflow:hidden;}
${frameCss(params.brand)}
.header{position:absolute;top:${pt(HEADER_TOP)};left:${pt(MARGIN_X)};right:${pt(MARGIN_X)};height:${pt(CONTENT_TOP - HEADER_TOP - 18)};}
.footer{position:absolute;bottom:${pt(page.reserveBottom)};left:${pt(MARGIN_X)};right:${pt(MARGIN_X)};height:${pt(footerHeight)};}`;
  return `${head(params, css)}<body><div class="page">${parts.header}${parts.footer}</div></body></html>`;
}

/**
 * One sheet for the screen: letterhead, body and footer in the page flow. For previews in an
 * `<iframe>`; page breaks show as dashed rules.
 */
export function previewHtml(
  params: PageParams & { body: string; footer: string | null; reference: string | null },
): string {
  const { page } = params;
  const parts = frameParts(params.brand, params.footer, params.reference);
  const css = `${documentCss(color(params.brand.primaryColor, INK))}${frameCss(params.brand)}
html{background:#e4e4e7;}
body{padding:24px 12px;}
.sheet{background:#fff;width:${pt(page.width)};max-width:100%;min-height:${pt(page.height)};margin:0 auto;padding:${pt(HEADER_TOP)} ${pt(MARGIN_X)} ${pt(Math.max(page.reserveBottom, 24))};box-shadow:0 1px 3px rgb(0 0 0 / .15);display:flex;flex-direction:column;}
.sheet>.header{margin-bottom:18pt;}
.sheet>.body{flex:1;}
.sheet>.footer{margin-top:18pt;}
.page-break{border-top:1px dashed ${RULE};margin:16pt 0;}`;
  return `${head(params, css)}<body><div class="sheet">${parts.header}<div class="body">${params.body}</div>${parts.footer}</div></body></html>`;
}
