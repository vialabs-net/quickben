import Link from "next/link";

import { Badge } from "../ui/badge";
import { cn, focusRing } from "../ui/cn";

import type { NavGroup } from "../nav";
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
  /** Shown at the top of the sidebar, under the title. */
  sidebarTop?: ReactNode;
  children: ReactNode;
}

function linkClass(active: boolean): string {
  return cn(
    "qb:flex qb:items-center qb:rounded-md qb:px-2.5 qb:py-1.5 qb:text-sm",
    active
      ? "qb:bg-zinc-100 qb:font-medium qb:text-zinc-900"
      : "qb:text-zinc-600 qb:hover:bg-zinc-50 qb:hover:text-zinc-900",
    focusRing,
  );
}

/** Admin layout: sidebar with navigation and the current user, and the main area. */
export function Shell({
  title,
  basePath,
  groups,
  current,
  user,
  sidebarTop,
  children,
}: Readonly<ShellProps>) {
  return (
    <div className="qb-root qb:min-h-screen qb:bg-zinc-50 qb:text-zinc-900 qb:md:flex">
      <a
        href="#qb-main"
        className="qb:sr-only qb:focus:not-sr-only qb:focus:absolute qb:focus:top-2 qb:focus:left-2 qb:focus:z-50 qb:focus:rounded-md qb:focus:bg-white qb:focus:px-3 qb:focus:py-2 qb:focus:shadow"
      >
        Skip to content
      </a>
      <aside className="qb:flex qb:flex-col qb:border-b qb:border-zinc-200 qb:bg-white qb:md:sticky qb:md:top-0 qb:md:h-screen qb:md:w-64 qb:md:shrink-0 qb:md:border-r qb:md:border-b-0">
        <div className="qb:flex qb:h-14 qb:items-center qb:px-5">
          <Link
            href={basePath}
            className={cn("qb:truncate qb:font-semibold qb:text-zinc-900", focusRing)}
          >
            {title}
          </Link>
        </div>
        {sidebarTop ? <div className="qb:space-y-3 qb:px-3 qb:pb-4">{sidebarTop}</div> : null}
        <nav
          aria-label="Admin"
          className="qb:flex qb:flex-wrap qb:gap-x-6 qb:gap-y-4 qb:px-3 qb:pb-4 qb:md:block qb:md:flex-1 qb:md:space-y-5 qb:md:overflow-y-auto"
        >
          <ul>
            <li>
              <Link
                href={basePath}
                className={linkClass(current === null)}
                aria-current={current === null ? "page" : undefined}
              >
                Dashboard
              </Link>
            </li>
          </ul>
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="qb:px-2.5 qb:pb-1 qb:text-xs qb:font-semibold qb:tracking-wide qb:text-zinc-400 qb:uppercase">
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
                        <span className="qb:sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className={linkClass(link.key === current)}
                        aria-current={link.key === current ? "page" : undefined}
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
        <div className="qb:hidden qb:border-t qb:border-zinc-200 qb:px-5 qb:py-4 qb:text-sm qb:md:block">
          {user ? (
            <>
              <p className="qb:truncate qb:font-medium qb:text-zinc-900">{user.email ?? user.id}</p>
              {user.roles && user.roles.length > 0 ? (
                <p className="qb:mt-1 qb:flex qb:flex-wrap qb:gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                </p>
              ) : null}
            </>
          ) : (
            <p className="qb:text-zinc-500">Not signed in</p>
          )}
        </div>
      </aside>
      <main
        id="qb-main"
        className="qb:min-w-0 qb:flex-1 qb:px-4 qb:py-6 qb:sm:px-6 qb:lg:px-10 qb:lg:py-8"
      >
        {children}
      </main>
    </div>
  );
}
