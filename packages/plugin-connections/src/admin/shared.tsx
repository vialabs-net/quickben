import { englishI18n } from "@quickben/admin/i18n";
import { Badge } from "@quickben/admin/ui";
import Link from "next/link";

import { connectionState } from "../api";

import { connectionsMessages } from "./messages";

import type { LastTest } from "../collections";
import type { ProviderLogo } from "../provider";
import type { AdminI18n } from "@quickben/admin";
import type { ReactNode } from "react";

/** A date and time for the locale, with its ISO value for machines. */
export function DateTime({ value, i18n }: Readonly<{ value: string; i18n: AdminI18n }>) {
  return <time dateTime={value}>{i18n.dateTime(value)}</time>;
}

/** `3 days ago`, with the full date and time as a tooltip. */
export function RelativeTime({ value, i18n }: Readonly<{ value: string; i18n: AdminI18n }>) {
  return (
    <time dateTime={value} title={i18n.dateTime(value)}>
      {i18n.relativeTime(value)}
    </time>
  );
}

/** A breadcrumb link. */
export interface Crumb {
  label: string;
  href?: string;
}

/** Title row of a page: breadcrumbs, title, description and actions. Same look as the admin. */
export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  leading,
  i18n,
}: Readonly<{
  i18n: AdminI18n;
  title: string;
  description?: string | null;
  crumbs?: Crumb[];
  actions?: ReactNode;
  leading?: ReactNode;
}>) {
  return (
    <header className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:justify-between qb:gap-4">
      <div className="qb:min-w-0">
        {crumbs.length > 0 ? (
          <nav aria-label={i18n.t("nav.breadcrumb")} className="qb-page-crumbs qb:mb-1">
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
        <div className="qb:flex qb:items-center qb:gap-3">
          {leading}
          <h1 className="qb-page-title qb:truncate qb:tracking-tight qb:text-fg">{title}</h1>
        </div>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="qb:flex qb:gap-2">{actions}</div> : null}
    </header>
  );
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * A provider's mark in a square tile, or its initials. The admin has a light theme, so the
 * light ink is shown; `logo.dark` is there for apps with a dark UI.
 */
export function ProviderMark({
  label,
  logo,
  muted = false,
}: Readonly<{ label: string; logo: ProviderLogo | null | undefined; muted?: boolean }>) {
  const size = logo?.keyline === "circle" ? 26 : 22;
  return (
    <span
      className="qb:inline-flex qb:shrink-0 qb:items-center qb:justify-center qb:rounded-md qb:border qb:border-line qb:bg-surface"
      style={{ width: 36, height: 36, opacity: muted ? 0.5 : 1 }}
    >
      {logo ? (
        <img src={logo.light} alt="" width={size} height={size} />
      ) : (
        <span aria-hidden="true" className="qb:text-xs qb:font-semibold qb:text-fg-muted">
          {initials(label)}
        </span>
      )}
    </span>
  );
}

const stateTones = { active: "green", failed: "red", untested: "neutral" } as const;

/** The state from the last test, as a badge. English unless `i18n` is given. */
export function TestBadge({
  lastTest,
  i18n = englishI18n,
}: Readonly<{ lastTest: LastTest | null; i18n?: AdminI18n }>) {
  const state = connectionState(lastTest);
  const { t } = i18n.scope(connectionsMessages);
  return <Badge tone={stateTones[state]}>{t(`state.${state}`)}</Badge>;
}

/** When and how the last test went. */
export function LastTestDetails({
  lastTest,
  i18n,
}: Readonly<{ lastTest: LastTest | null; i18n: AdminI18n }>) {
  const { t } = i18n.scope(connectionsMessages);
  if (!lastTest) return <p className="qb:text-sm qb:text-fg-muted">{t("lastTest.never")}</p>;
  return (
    <div className="qb:space-y-1 qb:text-sm">
      <p className="qb:text-fg">
        <TestBadge lastTest={lastTest} i18n={i18n} /> <DateTime value={lastTest.at} i18n={i18n} />
      </p>
      {lastTest.latencyMs === null ? null : (
        <p className="qb:text-fg-muted">
          {lastTest.model
            ? t("lastTest.modelLatency", { model: lastTest.model, latency: lastTest.latencyMs })
            : t("lastTest.latency", { latency: lastTest.latencyMs })}
        </p>
      )}
      {lastTest.error ? <p className="qb:text-danger">{lastTest.error}</p> : null}
    </div>
  );
}

/** A label and a value in a details list. */
export function Detail({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="qb:text-fg-muted">{label}</dt>
      <dd className="qb:text-fg">{children}</dd>
    </div>
  );
}
