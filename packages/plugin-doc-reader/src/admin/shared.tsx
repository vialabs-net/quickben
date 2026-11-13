import { Badge, Card, CardBody, Toast } from "@quickben/admin/ui";

import { describeIssue, errorMessage, toastMessage } from "./feedback";

import type { BadgeTone } from "@quickben/admin/ui";
import type { ReactNode } from "react";

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Title row of a page. */
export function Heading({
  title,
  description,
  actions,
}: Readonly<{ title: string; description?: ReactNode; actions?: ReactNode }>) {
  return (
    <header className="qb:mb-6 qb:flex qb:flex-wrap qb:items-end qb:justify-between qb:gap-4">
      <div className="qb:min-w-0">
        <h1 className="qb:text-2xl qb:font-semibold qb:tracking-tight qb:text-zinc-900">{title}</h1>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="qb:flex qb:flex-wrap qb:gap-2">{actions}</div> : null}
    </header>
  );
}

/** A card with one message. */
export function Notice({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Card>
      <CardBody>
        <p className="qb:text-sm qb:text-zinc-600">{children}</p>
      </CardBody>
    </Card>
  );
}

/**
 * Toast for the `?toast=` or `?error=` code set by the server actions. Codes map to fixed
 * messages; unknown codes show nothing. `?issue=` names the invalid value of a form.
 */
export function Feedback({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const error = errorMessage(first(searchParams.error));
  if (error) {
    const issue = describeIssue(first(searchParams.issue));
    const message = issue ? `${error} Check: ${issue}.` : error;
    return <Toast message={message} tone="error" param="error" duration={8000} />;
  }
  const toast = toastMessage(first(searchParams.toast));
  return toast ? <Toast message={toast} param="toast" /> : null;
}

/** A label + control column for forms. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: Readonly<{
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <div className={className ? `qb:space-y-1.5 ${className}` : "qb:space-y-1.5"}>
      <label htmlFor={htmlFor} className="qb:text-sm qb:font-medium qb:text-zinc-900">
        {label}
      </label>
      {children}
      {hint ? <p className="qb:text-xs qb:text-zinc-500">{hint}</p> : null}
    </div>
  );
}

/** A number with its label, for summaries. */
export function Stat({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="qb:space-y-0.5">
      <p className="qb:text-xs qb:font-medium qb:tracking-wide qb:text-zinc-500 qb:uppercase">
        {label}
      </p>
      <p className="qb:text-lg qb:font-semibold qb:text-zinc-900 qb:tabular-nums">{children}</p>
    </div>
  );
}

/** USD with cents, or with four decimals for fractions of a cent. */
export function formatUsd(usd: number): string {
  // Whole cents show two decimals; reads that cost fractions of a cent show four.
  const digits = Math.round(usd * 100) / 100 === usd ? 2 : 4;
  return `US$${usd.toFixed(digits)}`;
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${String(Math.round(ratio * 100))}%`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** `2026-11-13 10:22 UTC`. */
export function formatWhen(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—";
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const stateTones: Record<string, BadgeTone> = {
  queued: "blue",
  running: "amber",
  done: "green",
  failed: "red",
  cancelled: "neutral",
  draft: "amber",
  published: "green",
};

const statusTones: Record<string, BadgeTone> = {
  OK: "green",
  INCOMPLETE: "amber",
  NO_MATCH: "neutral",
  NO_TEXT: "neutral",
  ERROR: "red",
  SKIPPED: "neutral",
};

export function StateBadge({ state }: Readonly<{ state: string }>) {
  return <Badge tone={stateTones[state] ?? "neutral"}>{state}</Badge>;
}

export function StatusBadge({ status }: Readonly<{ status: string | null }>) {
  if (!status) return <span className="qb:text-zinc-400">—</span>;
  return <Badge tone={statusTones[status] ?? "neutral"}>{status}</Badge>;
}

/** A horizontal bar for a share 0..1, red at 100 %, amber from 80 %. */
export function Meter({ ratio, label }: Readonly<{ ratio: number | null; label: string }>) {
  if (ratio === null) return <span className="qb:text-sm qb:text-zinc-400">No budget</span>;
  let color = "rgb(16 185 129)";
  if (ratio >= 1) color = "rgb(220 38 38)";
  else if (ratio >= 0.8) color = "rgb(217 119 6)";
  return (
    <div className="qb:flex qb:items-center qb:gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        className="qb:w-40 qb:rounded qb:bg-zinc-100"
        style={{ height: "0.5rem" }}
      >
        <div
          className="qb:h-full qb:rounded"
          style={{ width: `${String(Math.min(100, ratio * 100))}%`, background: color }}
        />
      </div>
      <span className="qb:text-xs qb:text-zinc-600 qb:tabular-nums">{formatPercent(ratio)}</span>
    </div>
  );
}

/** A link styled as text. */
export const linkClass = "qb:font-medium qb:text-blue-700 qb:hover:underline";

/** Bytes as base64, for a file preview. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/** Largest file shown inline in a preview. */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A submit button next to fields that have a hint: it lines up with the inputs, not with the
 * hints. The offset is one label line (`text-sm`) plus the field's `space-y-1.5`.
 */
export function AlignedSubmit({ children }: Readonly<{ children: ReactNode }>) {
  return <div style={{ paddingTop: "1.625rem" }}>{children}</div>;
}
