import { ConfigError } from "@quickben/core";

import type { AdminOptions, ResolvedExtensions } from "./types";
import type { QuickbenConfig } from "@quickben/core";

const pagePathPattern = /^[a-z][a-z\d-]{0,62}$/;

/** Merge `options.extensions` and the options themselves. Later ones win per name. */
export function resolveExtensions(options: AdminOptions): ResolvedExtensions {
  const resolved: ResolvedExtensions = { components: {}, views: {}, pages: [], nav: [] };
  for (const extension of [...(options.extensions ?? []), options]) {
    Object.assign(resolved.components, extension.components);
    for (const [slug, views] of Object.entries(extension.views ?? {})) {
      resolved.views[slug] = { ...resolved.views[slug], ...views };
    }
    for (const page of extension.pages ?? []) {
      resolved.pages = [...resolved.pages.filter((existing) => existing.path !== page.path), page];
    }
    resolved.nav.push(...(extension.nav ?? []));
  }
  return resolved;
}

/** Check custom page paths: valid, unique and not a collection slug. */
export function assertPages(config: QuickbenConfig, extensions: ResolvedExtensions): void {
  const slugs = new Set(config.collections.map((collection) => collection.slug));
  for (const page of extensions.pages) {
    if (!pagePathPattern.test(page.path)) {
      throw new ConfigError(
        `Invalid admin page path "${page.path}". Use lowercase letters, digits and "-".`,
      );
    }
    if (slugs.has(page.path)) {
      throw new ConfigError(`Admin page path "${page.path}" is also a collection slug`);
    }
  }
}

/** `admin/` → `/admin`. */
export function normalizeBasePath(basePath: string): string {
  let end = basePath.length;
  while (end > 0 && basePath[end - 1] === "/") end -= 1;
  const trimmed = basePath.slice(0, end);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
