"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminNav } from "@quickben/admin";

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Links of the host navigation. The current one is marked with `aria-current`. */
export function HostNavLinks({ nav }: Readonly<{ nav: AdminNav }>) {
  const pathname = usePathname();
  const links = [nav.dashboard, ...nav.groups.flatMap((group) => group.links)];
  return (
    <nav aria-label="Host" className="host-nav">
      <ul>
        {links.map((link) => {
          const active = isActive(pathname, link.href, link === nav.dashboard);
          return (
            <li key={link.href}>
              <Link href={link.href} aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
