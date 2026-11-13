import { Card, CardBody, Toast } from "@quickben/admin/ui";

import { resolveTenant } from "../api";
import { OrganizationError } from "../tenant";

import { errorMessage, toastMessage } from "./feedback";

import type { Tenant } from "../tenant";
import type { Quickben, RequestContext } from "@quickben/core";
import type { ReactNode } from "react";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Title row of a tenancy page. */
export function Heading({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <header className="qb:mb-6">
      <h1 className="qb:text-2xl qb:font-semibold qb:tracking-tight qb:text-zinc-900">{title}</h1>
      <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">{description}</p>
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
 * messages; unknown codes show nothing.
 */
export function Feedback({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const error = errorMessage(first(searchParams.error));
  if (error) return <Toast message={error} tone="error" param="error" duration={8000} />;
  const toast = toastMessage(first(searchParams.toast));
  return toast ? <Toast message={toast} param="toast" /> : null;
}

/** The tenant, or the message to show instead. */
export async function tenantOrMessage(
  qb: Quickben,
  ctx: RequestContext,
): Promise<{ tenant: Tenant; message: null } | { tenant: null; message: string }> {
  if (!ctx.user) return { tenant: null, message: "Sign in to manage an organization." };
  try {
    return { tenant: await resolveTenant(qb, ctx), message: null };
  } catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    const hint =
      error.reason === "none"
        ? "Create an organization or ask to be invited."
        : "Choose an organization in the sidebar.";
    return { tenant: null, message: `${error.message}. ${hint}` };
  }
}

/** A label + control column for forms. */
export function Field({
  label,
  htmlFor,
  children,
}: Readonly<{ label: string; htmlFor: string; children: ReactNode }>) {
  return (
    <div className="qb:space-y-1.5">
      <label htmlFor={htmlFor} className="qb:text-sm qb:font-medium qb:text-zinc-900">
        {label}
      </label>
      {children}
    </div>
  );
}
