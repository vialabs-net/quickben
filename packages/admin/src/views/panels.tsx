import Link from "next/link";

import { ButtonLink } from "../ui/button";
import { Card, CardBody } from "../ui/card";

import type { AdminI18n } from "../i18n/translator";
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
  i18n,
}: Readonly<{
  title: string;
  description?: string | null;
  crumbs?: Crumb[];
  actions?: ReactNode;
  /** Needed with `crumbs`, for the breadcrumb label. */
  i18n?: AdminI18n;
}>) {
  return (
    <header className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:justify-between qb:gap-4">
      <div className="qb:min-w-0">
        {crumbs.length > 0 ? (
          <nav aria-label={i18n?.t("nav.breadcrumb")} className="qb-page-crumbs qb:mb-1">
            <ol className="qb:flex qb:flex-wrap qb:items-center qb:gap-1.5 qb:text-sm qb:text-fg-muted">
              {crumbs.map((crumb, index) => (
                <li
                  key={`${crumb.label}-${String(index)}`}
                  className="qb:flex qb:items-center qb:gap-1.5"
                >
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="qb:hover:text-fg qb:hover:underline">
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
        <h1 className="qb-page-title qb:truncate qb:tracking-tight qb:text-fg">{title}</h1>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-fg-muted">{description}</p> : null}
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
  i18n,
}: Readonly<{
  message: string;
  signInHref: string | undefined;
  signedIn: boolean;
  i18n: AdminI18n;
}>) {
  return (
    <Card className="qb:max-w-xl">
      <CardBody className="qb:space-y-3">
        <h1 className="qb:text-lg qb:font-semibold">
          {signedIn ? i18n.t("access.denied") : i18n.t("access.signInRequired")}
        </h1>
        <p className="qb:text-sm qb:text-fg-muted">{message}</p>
        {!signedIn && signInHref ? (
          <ButtonLink href={signInHref} variant="primary">
            {i18n.t("access.signIn")}
          </ButtonLink>
        ) : null}
      </CardBody>
    </Card>
  );
}
