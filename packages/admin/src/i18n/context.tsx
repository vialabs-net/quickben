"use client";

import { createContext, use, useMemo } from "react";

import { createAdminI18n, englishI18n } from "./translator";

import type { AdminI18n, AdminI18nData } from "./translator";
import type { ReactNode } from "react";

const AdminI18nContext = createContext<AdminI18n>(englishI18n);

/**
 * Provides the admin locale to client components. The admin renders it around every page;
 * render it yourself only for client components outside the admin.
 */
export function AdminI18nProvider({
  value,
  children,
}: Readonly<{ value: AdminI18nData; children: ReactNode }>) {
  const i18n = useMemo(() => createAdminI18n(value), [value]);
  return <AdminI18nContext value={i18n}>{children}</AdminI18nContext>;
}

/** The admin translator in client components. English outside an {@link AdminI18nProvider}. */
export function useAdminI18n(): AdminI18n {
  return use(AdminI18nContext);
}
