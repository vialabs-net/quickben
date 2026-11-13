import { getPageMap } from "nextra/page-map";

import { site } from "../lib/site";

import type { MetadataRoute } from "next";
import type { PageMapItem } from "nextra";

export const dynamic = "force-static";

function routes(items: readonly PageMapItem[]): string[] {
  return items.flatMap((item) => {
    if ("children" in item) return routes(item.children);
    // Pages have front matter. Folders, separators and external links do not.
    return "frontMatter" in item ? [item.route] : [];
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const all = new Set(["/", ...routes(await getPageMap())]);
  return [...all]
    .sort((a, b) => a.localeCompare(b))
    .map((route) => ({ url: new URL(route, site.url).toString() }));
}
