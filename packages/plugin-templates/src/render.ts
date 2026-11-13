import { NotFoundError, ValidationError } from "@quickben/core";

import {
  cleanText,
  CUSTOM_FONT,
  defaultBrand,
  isHexColor,
  parseDataUrl,
  systemFonts,
  toDataUrl,
} from "./brand";
import { system } from "./collections";
import { asContent } from "./content";
import { getTemplatesPlugin } from "./options";
import { RendererUnavailableError } from "./pdf";
import { documentHtml, footerHtml, frameHtml, previewHtml, renderBlocks } from "./serialize";
import { getBrand, getPublishedVersion, getTemplate, getTemplateKind } from "./service";

import type { BrandFields, BrandRender, CustomFont, FontFaceSource } from "./brand";
import type { TemplateContent } from "./content";
import type { ResolvedKind } from "./kinds";
import type { ResolvedTemplates } from "./options";
import type { RenderContext, ResolvedPage } from "./serialize";
import type { VersionDetail } from "./service";
import type { ResolvedFormat, TemplateData } from "./values";
import type { DocumentData, Quickben, RequestContext } from "@quickben/core";

/** A rendered document. */
export interface RenderedDocument {
  title: string;
  /** The printable body, with `@page` margins for the letterhead. */
  html: string;
  /** The letterhead and footer on one transparent page. */
  letterhead: string;
  /** One sheet for the screen: letterhead, body and footer. For an `<iframe srcdoc>`. */
  preview: string;
  /** The PDF author: the brand's legal or display name. */
  author: string | null;
}

/** Input of {@link renderDocument}. */
export interface RenderDocumentInput {
  kind: ResolvedKind;
  content: TemplateContent;
  data: TemplateData;
  brand: BrandRender;
  format: ResolvedFormat;
  page: ResolvedPage;
  /** Title of the HTML and PDF. Default: the kind's label. */
  title?: string;
  /** Text at the bottom right of every page, e.g. a document number. */
  reference?: string | null;
}

/** The brand values templates can print as `brand.*`. */
function brandData(brand: BrandRender): Record<string, string | null> {
  return {
    name: brand.displayName ?? brand.legalName,
    legalName: brand.legalName,
    taxId: brand.taxId,
    address: brand.address,
    contact: brand.contact,
  };
}

/** Render content to HTML. Pure: no database, no I/O. */
export function renderDocument(input: RenderDocumentInput): RenderedDocument {
  const data: TemplateData = { ...input.data, brand: brandData(input.brand) };
  const ctx: RenderContext = { kind: input.kind, data, format: input.format };
  const body = renderBlocks(input.content.content, ctx);
  const footer = footerHtml(input.content, ctx);
  const params = {
    brand: input.brand,
    page: input.page,
    title: input.title ?? input.kind.label,
    lang: input.format.locale.split("-")[0] ?? "en",
  };
  const reference = input.reference ?? null;
  return {
    title: params.title,
    html: documentHtml({ ...params, body, tallFooter: footer !== null }),
    letterhead: frameHtml({ ...params, footer, reference }),
    preview: previewHtml({ ...params, body, footer, reference }),
    author: input.brand.legalName ?? input.brand.displayName,
  };
}

/* Brand assets */

const fontCache = new WeakMap<object, Promise<readonly FontFaceSource[]>>();
const assetCache = new Map<string, Promise<string | null>>();
const ASSET_CACHE_SIZE = 64;

/** A stored asset as a `data:` URL. References go through `assets.load` and are cached. */
async function assetUrl(
  templates: ResolvedTemplates,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("data:")) return parseDataUrl(value) ? value : null;
  const store = templates.assets;
  if (!store) return null;
  let entry = assetCache.get(value);
  if (!entry) {
    entry = store.load(value).then((file) => (file ? toDataUrl(file.bytes, file.mimeType) : null));
    entry.catch(() => assetCache.delete(value));
    assetCache.set(value, entry);
    while (assetCache.size > ASSET_CACHE_SIZE) {
      const oldest = assetCache.keys().next().value;
      if (oldest === undefined) break;
      assetCache.delete(oldest);
    }
  }
  return entry;
}

async function customFaces(
  templates: ResolvedTemplates,
  font: CustomFont | null,
): Promise<FontFaceSource[] | null> {
  if (!font) return null;
  const [regular, bold] = await Promise.all([
    assetUrl(templates, font.regular),
    assetUrl(templates, font.bold),
  ]);
  if (!regular) return null;
  const faces: FontFaceSource[] = [{ weight: 400, style: "normal", url: regular }];
  if (bold) faces.push({ weight: 700, style: "normal", url: bold });
  return faces;
}

const genericStacks = {
  "sans-serif": systemFonts[0].stack,
  serif: systemFonts[1].stack,
  monospace: systemFonts[2].stack,
} as const;

async function fontOf(
  templates: ResolvedTemplates,
  fields: BrandFields,
): Promise<{ faces: readonly FontFaceSource[]; stack: string }> {
  if (fields.font === CUSTOM_FONT) {
    const faces = await customFaces(templates, fields.customFont);
    if (faces) return { faces, stack: genericStacks["sans-serif"] };
  }
  const registered = templates.fonts.find((font) => font.key === fields.font);
  if (registered) {
    let faces = fontCache.get(registered);
    if (!faces) {
      faces = registered.faces();
      faces.catch(() => fontCache.delete(registered));
      fontCache.set(registered, faces);
    }
    return { faces: await faces, stack: genericStacks[registered.generic] };
  }
  const system = systemFonts.find((font) => font.key === fields.font) ?? systemFonts[0];
  return { faces: [], stack: system.stack };
}

/** Brand fields a preview may change before they are saved. */
export type BrandDraft = Partial<BrandFields>;

function brandFieldsOf(doc: DocumentData | null, draft: BrandDraft): BrandFields {
  const merged = { ...defaultBrand, ...(doc ?? {}), ...draft } as Record<string, unknown>;
  const text = (key: keyof typeof defaultBrand, max: number) => cleanText(merged[key], max);
  return {
    displayName: text("displayName", 120),
    legalName: text("legalName", 160),
    taxId: text("taxId", 40),
    address: text("address", 200),
    contact: text("contact", 200),
    footer:
      typeof merged.footer === "string" && merged.footer.trim() !== ""
        ? merged.footer.trim()
        : null,
    primaryColor: isHexColor(merged.primaryColor) ? merged.primaryColor : defaultBrand.primaryColor,
    accentColor: isHexColor(merged.accentColor) ? merged.accentColor : defaultBrand.accentColor,
    font: typeof merged.font === "string" ? merged.font : defaultBrand.font,
    customFont: (merged.customFont as CustomFont | null | undefined) ?? null,
    logo: typeof merged.logo === "string" ? merged.logo : null,
  };
}

/** Everything a render needs from the brand of the context's organization. */
export async function loadBrand(
  qb: Quickben,
  ctx: RequestContext = system,
  draft: BrandDraft = {},
): Promise<BrandRender> {
  const templates = getTemplatesPlugin(qb);
  const fields = brandFieldsOf(await getBrand(qb, ctx), draft);
  const [logo, font] = await Promise.all([
    assetUrl(templates, fields.logo),
    fontOf(templates, fields),
  ]);
  const { displayName, legalName, taxId, address, contact, footer, primaryColor, accentColor } =
    fields;
  return {
    displayName,
    legalName,
    taxId,
    address,
    contact,
    footer,
    primaryColor,
    accentColor,
    font: fields.font,
    logo,
    faces: font.faces,
    stack: font.stack,
  };
}

/* Rendering with the database */

/** Input of {@link renderTemplate}. */
export interface RenderTemplateInput {
  kind: string;
  data: TemplateData;
  /**
   * Organization whose brand and templates to use. With tenancy and the default system
   * context, give one. It becomes `ctx.organizationId`.
   */
  organization?: string;
  /**
   * What to render: the published version (default; the base template when none is
   * published), the draft (or the published version when there is no draft), or content.
   */
  source?: "published" | "draft" | { content: unknown };
  /** Text at the bottom right of every page. */
  reference?: string | null;
  /** Title of the document. Default: the kind's label. */
  title?: string;
  /** Brand fields that override the stored brand, e.g. for a preview. */
  brand?: BrandDraft;
}

/** Which version a document was rendered from. `null`: the kind's base template or given content. */
export interface RenderedVersion {
  id: string;
  number: number;
  contentHash: string | null;
}

async function contentFor(
  qb: Quickben,
  kind: ResolvedKind,
  source: RenderTemplateInput["source"],
  ctx: RequestContext,
): Promise<{ content: TemplateContent; version: RenderedVersion | null }> {
  if (typeof source === "object") return { content: asContent(source.content), version: null };
  let version: VersionDetail | null;
  if (source === "draft") {
    const template = await getTemplate(qb, kind.kind, ctx);
    version = template.draft ?? template.published;
  } else {
    version = await getPublishedVersion(qb, kind.kind, ctx);
  }
  if (version) {
    return {
      content: version.content,
      version: { id: version.id, number: version.number, contentHash: version.contentHash },
    };
  }
  if (kind.baseTemplate) return { content: kind.baseTemplate, version: null };
  throw new NotFoundError(`No published template for "${kind.kind}"`);
}

function withOrganization(ctx: RequestContext, organization: string | undefined): RequestContext {
  if (organization === undefined) return ctx;
  if (organization === "")
    throw new ValidationError([{ path: "organization", message: "Give an organization id" }]);
  return { ...ctx, organizationId: organization };
}

/**
 * Render a kind to HTML with the published template and the brand. `ctx` defaults to a system
 * context (no access checks): pass the user's context to apply access rules.
 */
export async function renderTemplate(
  qb: Quickben,
  input: RenderTemplateInput,
  ctx: RequestContext = system,
): Promise<RenderedDocument & { version: RenderedVersion | null }> {
  const templates = getTemplatesPlugin(qb);
  const kind = getTemplateKind(qb, input.kind);
  const scope = withOrganization(ctx, input.organization);
  const [{ content, version }, brand] = await Promise.all([
    contentFor(qb, kind, input.source, scope),
    loadBrand(qb, scope, input.brand),
  ]);
  const rendered = renderDocument({
    kind,
    content,
    data: input.data,
    brand,
    format: templates.format,
    page: templates.page,
    ...(input.title === undefined ? {} : { title: input.title }),
    reference: input.reference ?? null,
  });
  return { ...rendered, version };
}

/**
 * Render a kind to PDF with the renderer of the plugin options. Throws
 * `RendererUnavailableError` when there is none or it fails.
 */
export async function renderPdf(
  qb: Quickben,
  input: RenderTemplateInput,
  ctx: RequestContext = system,
): Promise<{ pdf: Uint8Array; title: string; version: RenderedVersion | null }> {
  const renderer = getTemplatesPlugin(qb).pdf;
  if (!renderer) {
    throw new RendererUnavailableError(
      "No PDF renderer: set `pdf` in the templates plugin options",
    );
  }
  const rendered = await renderTemplate(qb, input, ctx);
  const pdf = await renderer.render({
    title: rendered.title,
    author: rendered.author,
    html: rendered.html,
    letterhead: rendered.letterhead,
  });
  return { pdf, title: rendered.title, version: rendered.version };
}
