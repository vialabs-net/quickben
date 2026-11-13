import type { ResolvedExtensions } from "./types";
import type { NavItem } from "@quickben/core";
import type { MetaResponse } from "@quickben/next";

/** A sidebar link. */
export interface NavLink {
  label: string;
  href: string;
  /** Collection slug or page path, to mark the current link. */
  key: string;
  external: boolean;
}

/** A sidebar section. */
export interface NavGroup {
  label: string;
  links: NavLink[];
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(href);
}

/**
 * Build the sidebar: one section per module (its `nav`, or its collections), then collections
 * outside modules by `admin.group` (default `Collections`), then custom pages and extra links.
 * Only collections the user can read appear. Hidden collections are left out.
 */
export function buildNav(
  meta: MetaResponse,
  extensions: ResolvedExtensions,
  basePath: string,
): NavGroup[] {
  const visible = new Map(
    meta.collections.filter((c) => !c.admin.hidden).map((c) => [c.slug, c] as const),
  );
  const linkFor = (item: NavItem): NavLink | null => {
    if (item.collection === undefined) return hrefLink(basePath, item.label, item.href ?? "/");
    const collection = visible.get(item.collection);
    if (!collection) return null;
    return {
      label: item.label,
      href: `${basePath}/${collection.slug}`,
      key: collection.slug,
      external: false,
    };
  };
  const collectionItem = (slug: string): NavItem => ({
    label: visible.get(slug)?.labels.plural ?? slug,
    collection: slug,
  });

  const groups = new NavGroups();
  const inModules = new Set(meta.modules.flatMap((module) => module.collections));
  for (const module of meta.modules) {
    const items = module.nav.length > 0 ? module.nav : module.collections.map(collectionItem);
    for (const item of items) groups.add(module.label, linkFor(item));
  }
  for (const collection of visible.values()) {
    if (inModules.has(collection.slug)) continue;
    groups.add(collection.admin.group ?? "Collections", linkFor(collectionItem(collection.slug)));
  }
  for (const page of extensions.pages) {
    groups.add(page.group ?? "Pages", {
      label: page.label,
      href: `${basePath}/${page.path}`,
      key: page.path,
      external: false,
    });
  }
  for (const item of extensions.nav) groups.add(item.group ?? "Links", linkFor(item));
  return groups.toArray();
}

function hrefLink(basePath: string, label: string, href: string): NavLink {
  const external = isExternal(href);
  return {
    label,
    href: external || href.startsWith("/") ? href : `${basePath}/${href}`,
    key: href,
    external,
  };
}

/** Sections in insertion order, without duplicate links. */
class NavGroups {
  private readonly groups = new Map<string, NavLink[]>();

  add(label: string, link: NavLink | null): void {
    if (!link) return;
    const links = this.groups.get(label) ?? [];
    if (!links.some((existing) => existing.href === link.href)) links.push(link);
    this.groups.set(label, links);
  }

  toArray(): NavGroup[] {
    return [...this.groups].map(([label, links]) => ({ label, links }));
  }
}
