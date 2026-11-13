import { definePlugin } from "@quickben/core";

import { brandsCollection, templatesCollection, versionsCollection } from "./collections";
import { register, resolveOptions, TEMPLATE_COLLECTIONS } from "./options";

import type {
  BrandsCollection,
  TemplatesCollection,
  TemplatesState,
  VersionsCollection,
} from "./collections";
import type { TemplatesOptions } from "./options";
import type { Plugin } from "@quickben/core";

/** The plugin returned by {@link templates}. */
export type TemplatesPlugin = Plugin<BrandsCollection | TemplatesCollection | VersionsCollection>;

/**
 * Document templates. Adds `brands`, `document-templates` and `document-template-versions`.
 * Templates are edited as drafts and published as immutable versions, one published version per
 * kind. Render them to HTML with `renderTemplate` and to PDF with `renderPdf`.
 *
 * With `@quickben/plugin-tenancy`, list this plugin first and add `TEMPLATE_COLLECTIONS` to the
 * tenancy scope: each organization then has its own brand and templates.
 */
export function templates(options: TemplatesOptions): TemplatesPlugin {
  const state: TemplatesState = { templates: resolveOptions(options) };
  return definePlugin({
    name: "templates",
    collections: [brandsCollection(state), templatesCollection(state), versionsCollection(state)],
    modules: options.module ? [{ ...options.module, collections: [...TEMPLATE_COLLECTIONS] }] : [],
    onInit: (qb) => {
      register(qb.config, state.templates);
    },
  });
}
