import { Card, CardBody, Toast } from "@quickben/admin/ui";
import { checkAccess, QuickbenError } from "@quickben/core";

import { errorCode, errorKey, toastKey } from "./feedback";

import type { FeedbackErrorCode } from "./feedback";
import type { TemplatesT } from "./messages";
import type { SearchParams } from "@quickben/admin";
import type { Quickben, RequestContext } from "@quickben/core";
import type { ReactNode } from "react";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Title row of a templates page. */
export function Heading({
  title,
  description,
  actions,
}: Readonly<{ title: string; description?: string; actions?: ReactNode }>) {
  return (
    <header className="qbt:mb-6 qbt:flex qbt:flex-wrap qbt:items-start qbt:justify-between qbt:gap-4">
      <div className="qbt:min-w-0">
        <h1 className="qbt:text-2xl qbt:font-semibold qbt:tracking-tight qbt:text-fg">{title}</h1>
        {description ? (
          <p className="qbt:mt-1 qbt:text-sm qbt:text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** A card with one message. */
export function Notice({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Card>
      <CardBody>
        <p className="qbt:text-sm qbt:text-fg-muted">{children}</p>
      </CardBody>
    </Card>
  );
}

/** Toast for the `?toast=` or `?error=` code of a redirect. Unknown codes show nothing. */
export function Feedback({
  searchParams,
  t,
}: Readonly<{ searchParams: SearchParams; t: TemplatesT }>) {
  const error = errorKey(first(searchParams.error));
  if (error) return <Toast message={t(error)} tone="error" param="error" duration={8000} />;
  const toast = toastKey(first(searchParams.toast));
  return toast ? <Toast message={t(toast)} param="toast" /> : null;
}

/** Load page data; a Quickben error becomes an error code (message `error.<code>`) instead. */
export async function load<T>(
  run: () => Promise<T>,
): Promise<{ value: T; code: null } | { value: null; code: FeedbackErrorCode }> {
  try {
    return { value: await run(), code: null };
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    return { value: null, code: errorCode(error) };
  }
}

/** Whether the user may change documents of a collection (create and update allowed). */
export async function canManage(qb: Quickben, slug: string, ctx: RequestContext): Promise<boolean> {
  const collection = qb.collections[slug];
  if (!collection) return false;
  try {
    const create = await checkAccess(collection, "create", ctx, { qb });
    const update = await checkAccess(collection, "update", ctx, { qb });
    return create !== false && update !== false;
  } catch (error) {
    if (error instanceof QuickbenError) return false;
    throw error;
  }
}

/** A label + control column for forms. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: Readonly<{ label: string; htmlFor: string; hint?: string; children: ReactNode }>) {
  return (
    <div className="qbt:space-y-1.5">
      <label htmlFor={htmlFor} className="qbt:block qbt:text-sm qbt:font-medium qbt:text-fg">
        {label}
      </label>
      {children}
      {hint ? <p className="qbt:text-xs qbt:text-fg-muted">{hint}</p> : null}
    </div>
  );
}
