import Link from "next/link";

import { ButtonLink } from "../ui/button";
import { Card, CardBody } from "../ui/card";

import type { ReactNode } from "react";

/** A breadcrumb link. */
export interface Crumb {
  label: string;
  href?: string;
}

/** Title row of a page: breadcrumbs, title, description and actions. */
export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
}: Readonly<{
  title: string;
  description?: string | null;
  crumbs?: Crumb[];
  actions?: ReactNode;
}>) {
  return (
    <header className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:justify-between qb:gap-4">
      <div className="qb:min-w-0">
        {crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="qb:mb-1">
            <ol className="qb:flex qb:flex-wrap qb:items-center qb:gap-1.5 qb:text-sm qb:text-zinc-500">
              {crumbs.map((crumb, index) => (
                <li
                  key={`${crumb.label}-${String(index)}`}
                  className="qb:flex qb:items-center qb:gap-1.5"
                >
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="qb:hover:text-zinc-900 qb:hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="qb:truncate qb:text-2xl qb:font-semibold qb:tracking-tight qb:text-zinc-900">
          {title}
        </h1>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="qb:flex qb:gap-2">{actions}</div> : null}
    </header>
  );
}

/** Shown when the user may not see a page. */
export function NotAllowed({
  message,
  signInHref,
  signedIn,
}: Readonly<{
  message: string;
  signInHref: string | undefined;
  signedIn: boolean;
}>) {
  return (
    <Card className="qb:max-w-xl">
      <CardBody className="qb:space-y-3">
        <h1 className="qb:text-lg qb:font-semibold">
          {signedIn ? "Access denied" : "Sign in required"}
        </h1>
        <p className="qb:text-sm qb:text-zinc-600">{message}</p>
        {!signedIn && signInHref ? (
          <ButtonLink href={signInHref} variant="primary">
            Sign in
          </ButtonLink>
        ) : null}
      </CardBody>
    </Card>
  );
}
