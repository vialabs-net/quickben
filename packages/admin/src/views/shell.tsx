import Link from "next/link";

import { AdminI18nProvider } from "../i18n/context";
import { themeStyle } from "../theme";
import { Badge } from "../ui/badge";
import { cn, focusRing } from "../ui/cn";

import type { AdminI18n } from "../i18n/translator";
import type { NavGroup } from "../nav";
import type { AdminTheme } from "../theme";
import type { AdminPageTitle } from "../types";
import type { QuickbenUser } from "@quickben/core";
import type { ReactNode } from "react";

/** Props of {@link Shell}. */
export interface ShellProps {
  title: string;
  basePath: string;
  groups: NavGroup[];
  /** Key of the current collection or page, or `null` on the dashboard. */
  current: string | null;
  user: QuickbenUser | null;
  i18n: AdminI18n;
  /** Shown at the top of the sidebar, under the title. */
  sidebarTop?: ReactNode;
  /** `none` hides the page titles. Default `render`. */
  pageTitle?: AdminPageTitle;
  /** Values for the `--qb-*` tokens. */
  theme?: AdminTheme;
  /** Shown before the title at the top of the sidebar. */
  logo?: ReactNode;
  children: ReactNode;
}

function linkClass(active: boolean): string {
  return cn(
    "qb:flex qb:items-center qb:rounded-md qb:px-2.5 qb:py-1.5 qb:text-sm",
    active
      ? "qb:bg-selected qb:font-medium qb:text-fg"
      : "qb:text-fg-muted qb:hover:bg-surface-muted qb:hover:text-fg",
    focusRing,
  );
}

/**
 * The `.qb-root` element with the locale for client components, and nothing else. Used by
 * `chrome: "none"` and inside {@link Shell}.
 */
export function AdminFrame({
  i18n,
  className,
  pageTitle = "render",
  theme,
  children,
}: Readonly<{
  i18n: AdminI18n;
  className?: string;
  /** `none` hides the page titles (`.qb-page-title`). */
  pageTitle?: AdminPageTitle;
  /** Values for the `--qb-*` tokens, set as inline custom properties. */
  theme?: AdminTheme;
  children: ReactNode;
}>) {
  return (
    <div
      className={cn("qb-root", className)}
      style={themeStyle(theme)}
      lang={i18n.locale}
      data-qb-page-title={pageTitle === "none" ? "none" : undefined}
    >
      <AdminI18nProvider value={i18n.data}>{children}</AdminI18nProvider>
    </div>
  );
}

/** Admin layout: sidebar with navigation and the current user, and the main area. */
export function Shell({
  title,
  basePath,
  groups,
  current,
  user,
  i18n,
  sidebarTop,
  pageTitle,
  theme,
  logo,
  children,
}: Readonly<ShellProps>) {
  return (
    <AdminFrame
      i18n={i18n}
      pageTitle={pageTitle}
      theme={theme}
      className="qb:min-h-screen qb:bg-surface-muted qb:text-fg qb:md:flex"
    >
      <a
        href="#qb-main"
        className="qb:sr-only qb:focus:not-sr-only qb:focus:absolute qb:focus:top-2 qb:focus:left-2 qb:focus:z-50 qb:focus:rounded-md qb:focus:bg-surface qb:focus:px-3 qb:focus:py-2 qb:focus:shadow"
      >
        {i18n.t("nav.skip")}
      </a>
      <aside className="qb:flex qb:flex-col qb:border-b qb:border-line qb:bg-surface qb:md:sticky qb:md:top-0 qb:md:h-screen qb:md:w-64 qb:md:shrink-0 qb:md:border-r qb:md:border-b-0">
        <div className="qb:flex qb:h-14 qb:items-center qb:px-5">
          <Link
            href={basePath}
            className={cn(
              "qb:flex qb:min-w-0 qb:items-center qb:gap-2.5 qb:font-semibold qb:text-fg-heading",
              focusRing,
            )}
          >
            {logo ? <span className="qb:flex qb:shrink-0 qb:items-center">{logo}</span> : null}
            <span className="qb:truncate">{title}</span>
          </Link>
        </div>
        {sidebarTop ? <div className="qb:space-y-3 qb:px-3 qb:pb-4">{sidebarTop}</div> : null}
        <nav
          aria-label={i18n.t("nav.label")}
          className="qb:flex qb:flex-wrap qb:gap-x-6 qb:gap-y-4 qb:px-3 qb:pb-4 qb:md:block qb:md:flex-1 qb:md:space-y-5 qb:md:overflow-y-auto"
        >
          <ul>
            <li>
              <Link
                href={basePath}
                className={linkClass(current === null)}
                aria-current={current === null ? "page" : undefined}
              >
                {i18n.t("nav.dashboard")}
              </Link>
            </li>
          </ul>
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="qb:px-2.5 qb:pb-1 qb:text-xs qb:font-semibold qb:tracking-wide qb:text-fg-subtle qb:uppercase">
                {group.label}
              </h2>
              <ul className="qb:space-y-0.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        className={linkClass(false)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.label}
                        <span className="qb:sr-only"> {i18n.t("nav.newTab")}</span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className={linkClass(link.active)}
                        aria-current={link.active ? "page" : undefined}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="qb:hidden qb:border-t qb:border-line qb:px-5 qb:py-4 qb:text-sm qb:md:block">
          {user ? (
            <>
              <p className="qb:truncate qb:font-medium qb:text-fg">{user.email ?? user.id}</p>
              {user.roles && user.roles.length > 0 ? (
                <p className="qb:mt-1 qb:flex qb:flex-wrap qb:gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                </p>
              ) : null}
            </>
          ) : (
            <p className="qb:text-fg-muted">{i18n.t("user.anonymous")}</p>
          )}
        </div>
      </aside>
      <main
        id="qb-main"
        className="qb:min-w-0 qb:flex-1 qb:px-4 qb:py-6 qb:sm:px-6 qb:lg:px-10 qb:lg:py-8"
      >
        {children}
      </main>
    </AdminFrame>
  );
}
