import { getQuickben } from "@quickben/core";
import { currentRequest, getMeta, getRequestContext } from "@quickben/next";

import { normalizeBasePath, resolveExtensions } from "./extensions";
import { documentTitle } from "./format";
import { resolveAdminI18nData, resolveAdminLocale } from "./i18n/resolve";
import { createAdminI18n } from "./i18n/translator";
import { adminText, buildNav, navKeyForPath } from "./nav";
import { resolveRoute } from "./route";

import type { AdminI18nOptions } from "./i18n/resolve";
import type { AdminI18n } from "./i18n/translator";
import type { AdminNav, AdminPageInfo } from "./nav";
import type { AdminOptions, ResolvedExtensions } from "./types";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { MetaResponse } from "@quickben/next";

/**
 * The admin locale of the current request, for `<html lang>` in your root layout:
 *
 * ```tsx
 * <html lang={await getAdminLocale(config)}>
 * ```
 */
export async function getAdminLocale(
  config: QuickbenConfig,
  options: AdminI18nOptions = {},
): Promise<string> {
  return resolveAdminLocale(config, options, await currentRequest());
}

/** The admin translator of the current request, for server components outside the admin. */
export async function getAdminI18n(
  config: QuickbenConfig,
  options: AdminI18nOptions = {},
): Promise<AdminI18n> {
  return createAdminI18n(await resolveAdminI18nData(config, options, await currentRequest()));
}

/** Options of {@link getAdminNav}. */
export interface AdminNavOptions {
  /**
   * Current path, e.g. from `usePathname()` or a `params` prop, to mark the active link and
   * to describe the current page in `page`.
   */
  pathname?: string;
}

interface PageInfoArgs {
  qb: Quickben;
  ctx: RequestContext;
  meta: MetaResponse;
  extensions: ResolvedExtensions;
  basePath: string;
  pathname: string;
  i18n: AdminI18n;
}

async function editTitle(args: PageInfoArgs, slug: string, id: string): Promise<string> {
  const collection = args.meta.collections.find((candidate) => candidate.slug === slug);
  try {
    const doc = await args.qb.findById(slug, id, { depth: 0 }, args.ctx);
    return documentTitle(collection, doc);
  } catch {
    return args.i18n.t("edit.crumbEdit");
  }
}

/** Title and breadcrumb of the admin page at `pathname`, as the page itself shows them. */
async function pageInfo(args: PageInfoArgs): Promise<AdminPageInfo | null> {
  const { meta, basePath, pathname, i18n } = args;
  const path = normalizeBasePath(pathname);
  if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
  const segments = path
    .slice(basePath.length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const collections = new Map(meta.collections.map((c) => [c.slug, c] as const));
  const route = resolveRoute(segments, new Set(collections.keys()), args.extensions.pages);
  if (route.kind === "dashboard") return { title: meta.title, crumbs: [] };
  if (route.kind === "notFound") return null;
  if (route.kind === "page") {
    const title = adminText(route.page.label, i18n);
    return { title, crumbs: [{ label: title }] };
  }
  const collection = collections.get(route.slug);
  if (!collection) return null;
  const plural = collection.labels.plural;
  if (route.kind === "list") return { title: plural, crumbs: [{ label: plural }] };
  const list = { label: plural, href: `${basePath}/${collection.slug}` };
  if (route.kind === "create") {
    return {
      title: i18n.t("edit.new", { singular: i18n.lower(collection.labels.singular) }),
      crumbs: [list, { label: i18n.t("edit.crumbNew") }],
    };
  }
  const title = await editTitle(args, route.slug, route.id);
  return { title, crumbs: [list, { label: title }] };
}

/**
 * The admin navigation for the current user: the dashboard link and the sections of the
 * sidebar, with the active link marked. Pass the same options as to `createAdminPage`, so
 * custom pages and plugin pages are included. Use it with `chrome: "none"` to build the
 * navigation of your own layout. With `pathname`, `page` has the title and breadcrumb of the
 * current page, for a layout that shows them itself (`pageTitle: "none"`).
 */
export async function getAdminNav(
  config: QuickbenConfig,
  options: AdminOptions = {},
  { pathname }: AdminNavOptions = {},
): Promise<AdminNav> {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const ctx = await getRequestContext(config);
  const i18n = createAdminI18n(await resolveAdminI18nData(config, options, ctx.req));
  const qb = await getQuickben(config);
  const meta = await getMeta(qb, ctx, { locale: i18n.locale });
  const current = pathname === undefined ? null : navKeyForPath(pathname, basePath);
  const onDashboard = pathname !== undefined && normalizeBasePath(pathname) === basePath;
  const extensions = resolveExtensions(options);
  const page =
    pathname === undefined
      ? {}
      : { page: await pageInfo({ qb, ctx, meta, extensions, basePath, pathname, i18n }) };
  return {
    title: meta.title,
    basePath,
    dashboard: {
      label: i18n.t("nav.dashboard"),
      href: basePath,
      key: "",
      external: false,
      active: onDashboard,
    },
    groups: buildNav(meta, extensions, basePath, i18n, current),
    current,
    ...page,
  };
}
