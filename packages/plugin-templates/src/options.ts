import { ConfigError } from "@quickben/core";

import { CUSTOM_FONT, systemFonts } from "./brand";
import { resolveKind } from "./kinds";
import { resolvePage } from "./serialize";
import { resolveFormat } from "./values";

import type { FontDefinition } from "./brand";
import type { ResolvedKind, TemplateKindDefinition } from "./kinds";
import type { PdfRenderer } from "./pdf";
import type { PageOptions, ResolvedPage } from "./serialize";
import type { FormatOptions, ResolvedFormat } from "./values";
import type { AccessArgs, Module, Quickben, QuickbenConfig } from "@quickben/core";

/** An access rule of the plugin: allowed or not. */
export type TemplatesAccessRule = (args: AccessArgs) => boolean | Promise<boolean>;

/** Slugs of the collections the plugin adds. */
export const BRANDS = "brands";
export const TEMPLATES = "document-templates";
export const VERSIONS = "document-template-versions";

/** Every collection of the plugin. Add them to `tenancy({ scope })` for one brand and set of templates per organization. */
export const TEMPLATE_COLLECTIONS = [BRANDS, TEMPLATES, VERSIONS] as const;

/**
 * Where uploaded files live when they are not stored inline as `data:` URLs. Without a store,
 * logos and fonts are kept in the brand document as `data:` URLs.
 */
export interface AssetStore {
  /** Store a file and return a reference to save in the brand. */
  save(file: { bytes: Uint8Array; mimeType: string; name: string }): Promise<string>;
  /** Read a file by reference. `null` when it is gone. */
  load(ref: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

/** Options of `templates()`. */
export interface TemplatesOptions {
  /** The template kinds of the product. See `defineTemplateKind`. */
  kinds: readonly TemplateKindDefinition[];
  /**
   * Who may read templates and the brand (`read`), and who may change them (`manage`).
   * Default: signed-in users. With tenancy, the organization's capabilities also apply.
   */
  access?: { read?: TemplatesAccessRule; manage?: TemplatesAccessRule };
  /** Locale, time zone and boolean words for printed values. */
  format?: FormatOptions;
  /** Page size and bottom reserve. */
  page?: PageOptions;
  /** Fonts besides the system ones (`sans`, `serif`, `mono`). */
  fonts?: readonly FontDefinition[];
  /** Turns rendered HTML into a PDF. See `@quickben/plugin-templates/chromium`. */
  pdf?: PdfRenderer;
  /** Storage for logos and fonts. Default: inline `data:` URLs. */
  assets?: AssetStore;
  /** Register a module with the plugin's collections, e.g. for tenancy entitlements. */
  module?: Omit<Module, "collections">;
}

/** Options after defaults. Read them with {@link getTemplatesPlugin}. */
export interface ResolvedTemplates {
  readonly kinds: ReadonlyMap<string, ResolvedKind>;
  readonly access: { read?: TemplatesAccessRule; manage?: TemplatesAccessRule };
  readonly format: ResolvedFormat;
  readonly page: ResolvedPage;
  readonly fonts: readonly FontDefinition[];
  /** Keys of every font a brand may use, `custom` included. */
  readonly fontKeys: readonly string[];
  readonly pdf: PdfRenderer | null;
  readonly assets: AssetStore | null;
}

export function resolveOptions(options: TemplatesOptions): ResolvedTemplates {
  const kinds = new Map<string, ResolvedKind>();
  for (const definition of options.kinds) {
    if (kinds.has(definition.kind)) {
      throw new ConfigError(`templates: kind "${definition.kind}" is registered twice`);
    }
    kinds.set(definition.kind, resolveKind(definition));
  }
  const fonts = options.fonts ?? [];
  const fontKeys = [
    ...systemFonts.map((font) => font.key),
    ...fonts.map((font) => font.key),
    CUSTOM_FONT,
  ];
  if (new Set(fontKeys).size !== fontKeys.length) {
    throw new ConfigError(
      "templates: font keys must be unique and not sans, serif, mono or custom",
    );
  }
  return {
    kinds,
    access: options.access ?? {},
    format: resolveFormat(options.format),
    page: resolvePage(options.page),
    fonts,
    fontKeys,
    pdf: options.pdf ?? null,
    assets: options.assets ?? null,
  };
}

const registered = new WeakMap<QuickbenConfig, ResolvedTemplates>();

export function register(config: QuickbenConfig, templates: ResolvedTemplates): void {
  registered.set(config, templates);
}

/** Resolved options of the templates plugin of an instance. Throws `ConfigError` when it is not installed. */
export function getTemplatesPlugin(qb: Quickben): ResolvedTemplates {
  const templates = registered.get(qb.config);
  if (!templates) throw new ConfigError("The templates plugin is not installed in this config");
  return templates;
}
