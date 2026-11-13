import { Badge } from "@quickben/admin/ui";
import Link from "next/link";

import { connectionState } from "../api";

import type { LastTest } from "../collections";
import type { ProviderLogo } from "../provider";
import type { ReactNode } from "react";

/** `2026-11-13T10:20:00.000Z` → `2026-11-13 10:20 UTC`, like the admin. */
export function formatDatetime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
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
}: Readonly<{
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
        <div className="qb:flex qb:items-center qb:gap-3">
          {leading}
          <h1 className="qb:truncate qb:text-2xl qb:font-semibold qb:tracking-tight qb:text-zinc-900">
            {title}
          </h1>
        </div>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">{description}</p> : null}
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
      className="qb:inline-flex qb:shrink-0 qb:items-center qb:justify-center qb:rounded-md qb:border qb:border-zinc-200 qb:bg-white"
      style={{ width: 36, height: 36, opacity: muted ? 0.5 : 1 }}
    >
      {logo ? (
        <img src={logo.light} alt="" width={size} height={size} />
      ) : (
        <span aria-hidden="true" className="qb:text-xs qb:font-semibold qb:text-zinc-600">
          {initials(label)}
        </span>
      )}
    </span>
  );
}

const stateLabels = { active: "Working", failed: "Failed", untested: "Not tested" } as const;
const stateTones = { active: "green", failed: "red", untested: "neutral" } as const;

/** The state from the last test, as a badge. */
export function TestBadge({ lastTest }: Readonly<{ lastTest: LastTest | null }>) {
  const state = connectionState(lastTest);
  return <Badge tone={stateTones[state]}>{stateLabels[state]}</Badge>;
}

/** When and how the last test went. */
export function LastTestDetails({ lastTest }: Readonly<{ lastTest: LastTest | null }>) {
  if (!lastTest) return <p className="qb:text-sm qb:text-zinc-500">Never tested.</p>;
  return (
    <div className="qb:space-y-1 qb:text-sm">
      <p className="qb:text-zinc-900">
        <TestBadge lastTest={lastTest} /> {formatDatetime(lastTest.at)}
      </p>
      {lastTest.latencyMs === null ? null : (
        <p className="qb:text-zinc-500">
          {lastTest.model ? `${lastTest.model}, ` : ""}
          {String(lastTest.latencyMs)} ms
        </p>
      )}
      {lastTest.error ? <p className="qb:text-red-600">{lastTest.error}</p> : null}
    </div>
  );
}

/** A label and a value in a details list. */
export function Detail({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="qb:text-zinc-500">{label}</dt>
      <dd className="qb:text-zinc-900">{children}</dd>
    </div>
  );
}
