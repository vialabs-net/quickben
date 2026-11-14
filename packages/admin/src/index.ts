export { getAdminI18n, getAdminLocale, getAdminNav } from "./embed";
export { createAdminPage } from "./page";
export { generateAdminMetadata } from "./metadata";
export { navKeyForPath } from "./nav";
export { handleAdminRequest } from "./server-function";

export type { AdminNavOptions } from "./embed";
export type { AdminNav, NavGroup as AdminNavGroup, NavLink as AdminNavLink } from "./nav";
export type { AdminPageProps } from "./page";
export type {
  AdminChrome,
  AdminExtension,
  AdminNavItem,
  AdminOptions,
  AdminPageDefinition,
  AdminRequest,
  AdminResult,
  AdminServerFunction,
  AdminText,
  FieldComponentProps,
  PageProps,
  RelationOption,
  SearchParams,
  SidebarProps,
  ViewProps,
} from "./types";
export type {
  AdminI18n,
  AdminI18nData,
  AdminI18nOptions,
  AdminMessageKey,
  MessageBundle,
  Translator,
} from "./i18n";
