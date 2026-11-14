import { getQuickben } from "@quickben/core";
import { currentRequest, getMeta, getRequestContext } from "@quickben/next";

import { normalizeBasePath, resolveExtensions } from "./extensions";
import { resolveAdminI18nData, resolveAdminLocale } from "./i18n/resolve";
import { createAdminI18n } from "./i18n/translator";
import { buildNav, navKeyForPath } from "./nav";

import type { AdminI18nOptions } from "./i18n/resolve";
import type { AdminI18n } from "./i18n/translator";
import type { AdminNav } from "./nav";
import type { AdminOptions } from "./types";
import type { QuickbenConfig } from "@quickben/core";

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
  /** Current path, e.g. from `usePathname()` or a `params` prop, to mark the active link. */
  pathname?: string;
}

/**
 * The admin navigation for the current user: the dashboard link and the sections of the
 * sidebar, with the active link marked. Pass the same options as to `createAdminPage`, so
 * custom pages and plugin pages are included. Use it with `chrome: "none"` to build the
 * navigation of your own layout.
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
    groups: buildNav(meta, resolveExtensions(options), basePath, i18n, current),
    current,
  };
}
