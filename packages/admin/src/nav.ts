import type { AdminI18n } from "./i18n/translator";
import type { AdminText, ResolvedExtensions } from "./types";
import type { NavItem } from "@quickben/core";
import type { MetaResponse } from "@quickben/next";

/** A sidebar link. */
export interface NavLink {
  label: string;
  href: string;
  /** Collection slug or page path, to mark the current link. */
  key: string;
  external: boolean;
  /** Whether this is the current page. */
  active: boolean;
}

/** A sidebar section. */
export interface NavGroup {
  label: string;
  links: NavLink[];
}

/** The admin navigation for the current user, to render in your own layout. */
export interface AdminNav {
  /** Admin title (`admin.title`). */
  title: string;
  basePath: string;
  /** The dashboard link. */
  dashboard: NavLink;
  /** Sections in sidebar order. */
  groups: NavGroup[];
  /** Key of the current collection or page, `null` on the dashboard or outside the admin. */
  current: string | null;
}

/** Resolve an {@link AdminText}. */
export function adminText(text: AdminText, i18n: AdminI18n): string {
  return typeof text === "function" ? text(i18n) : i18n.text(text);
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
  i18n: AdminI18n,
  current: string | null = null,
): NavGroup[] {
  const visible = new Map(
    meta.collections.filter((c) => !c.admin.hidden).map((c) => [c.slug, c] as const),
  );
  const link = (label: string, href: string, key: string, external = false): NavLink => ({
    label,
    href,
    key,
    external,
    active: !external && key === current,
  });
  const linkFor = (item: { label: string; collection?: string; href?: string }) => {
    if (item.collection === undefined)
      return hrefLink(basePath, item.label, item.href ?? "/", link);
    const collection = visible.get(item.collection);
    if (!collection) return null;
    return link(item.label, `${basePath}/${collection.slug}`, collection.slug);
  };
  const collectionItem = (slug: string): NavItem & { label: string } => ({
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
    groups.add(
      collection.admin.group ?? i18n.t("nav.collections"),
      linkFor(collectionItem(collection.slug)),
    );
  }
  for (const page of extensions.pages) {
    groups.add(
      page.group === undefined ? i18n.t("nav.pages") : adminText(page.group, i18n),
      link(adminText(page.label, i18n), `${basePath}/${page.path}`, page.path),
    );
  }
  for (const item of extensions.nav) {
    groups.add(
      item.group === undefined ? i18n.t("nav.links") : adminText(item.group, i18n),
      linkFor({ ...item, label: adminText(item.label, i18n) }),
    );
  }
  return groups.toArray();
}

function hrefLink(
  basePath: string,
  label: string,
  href: string,
  link: (label: string, href: string, key: string, external?: boolean) => NavLink,
): NavLink {
  const external = isExternal(href);
  return link(
    label,
    external || href.startsWith("/") ? href : `${basePath}/${href}`,
    href,
    external,
  );
}

/**
 * Key of the admin page at `pathname`: the first segment after the base path, or `null` for
 * the dashboard. Paths outside the base path also give `null`.
 */
export function navKeyForPath(pathname: string, basePath: string): string | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  const [first] = pathname.slice(basePath.length).split("/").filter(Boolean);
  return first === undefined ? null : decodeURIComponent(first);
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
