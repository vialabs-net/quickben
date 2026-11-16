import { getAdminNav } from "@quickben/admin";
import Link from "next/link";

import config from "@/quickben.config";

import { embeddedOptions } from "./options";

/**
 * The host's own page title and breadcrumb, from `getAdminNav(…).page`. The admin hides its
 * `<h1>` (`pageTitle: "none"`), so the title is not shown twice. Render it in `<Suspense>`.
 */
export async function HostTitle({
  params,
}: Readonly<{ params: Promise<{ segments?: string[] }> }>) {
  const { segments = [] } = await params;
  const pathname = [embeddedOptions.basePath, ...segments].join("/");
  const { page } = await getAdminNav(config, embeddedOptions, { pathname });
  if (!page) return null;
  return (
    <div className="host-title">
      {page.crumbs.length > 1 ? (
        <nav aria-label="Host breadcrumb">
          <ol>
            {page.crumbs.map((crumb) => (
              <li key={`${crumb.label}-${crumb.href ?? ""}`}>
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1>{page.title}</h1>
    </div>
  );
}
