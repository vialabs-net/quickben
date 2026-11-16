import type { MessageBundle } from "./i18n/catalog";
import type { AdminI18nOptions } from "./i18n/resolve";
import type { AdminI18n, AdminI18nData } from "./i18n/translator";
import type { LocalizedText, NavItem, QuickbenUser } from "@quickben/core";
import type { CollectionMeta, FieldMeta } from "@quickben/next";
import type { ComponentType } from "react";

/**
 * Text in the admin chrome: a string, a per-locale record, or a function of the translator,
 * e.g. `(i18n) => i18n.scope(messages).t("nav.reports")`.
 */
export type AdminText = LocalizedText | ((i18n: AdminI18n) => string);

/** Search parameters of a Next.js page. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Props of a custom field component, registered in `components` and chosen with
 * `admin: { component: "name" }` on a field. Props are plain data, so the component can be a
 * server or a client component.
 *
 * The component must render form controls named `name`. Their values are read like the
 * built-in input of the field type: a string for text, number, date and select fields, `"on"`
 * for a checked boolean, one value per control for `many` fields, JSON text for `json` fields.
 */
export interface FieldComponentProps {
  field: FieldMeta;
  /** Form control name. */
  name: string;
  /** Id for the main control, used by the field label. */
  id: string;
  /** Current value: the stored value on edit, the default (or `null`) on create. */
  value: unknown;
  required: boolean;
  /** `true` when the user may not change the document or the field is read-only. */
  disabled: boolean;
  /** Ids of the hint and error elements, for `aria-describedby`. */
  describedBy: string;
  /** Locale data: `createAdminI18n(i18n)` on the server, or `useAdminI18n()` in the browser. */
  i18n: AdminI18nData;
}

/** Props of a custom list or edit view. */
export interface ViewProps {
  collection: CollectionMeta;
  user: QuickbenUser | null;
  basePath: string;
  searchParams: SearchParams;
  /** Document id, for edit views of existing documents. */
  id?: string;
  i18n: AdminI18n;
}

/** Props of a custom admin page. */
export interface PageProps {
  user: QuickbenUser | null;
  basePath: string;
  /** Path segments after the page path: `/admin/reports/2024` gives `["2024"]`. */
  segments: string[];
  searchParams: SearchParams;
  i18n: AdminI18n;
  /** Server function of the admin, for field inputs (`FieldInput` relation searches). */
  serverFunction: AdminServerFunction;
}

/** Props of a sidebar component. */
export interface SidebarProps {
  user: QuickbenUser | null;
  basePath: string;
  i18n: AdminI18n;
}

/** A custom page inside the admin shell, at `<basePath>/<path>`. */
export interface AdminPageDefinition {
  /** First path segment. Lowercase letters, digits and `-`. Must not be a collection slug. */
  path: string;
  label: AdminText;
  /** Sidebar group. Default `Pages`. */
  group?: AdminText;
  component: ComponentType<PageProps>;
}

/** Extra sidebar link. */
export type AdminNavItem = Omit<NavItem, "label"> & { label: AdminText; group?: AdminText };

/**
 * Additions to the admin UI. Plugins can export one, and apps pass it in `extensions`.
 * Later extensions override earlier ones for the same component name or view.
 */
export interface AdminExtension {
  /** Custom field components by name. Fields pick one with `admin: { component: "name" }`. */
  components?: Readonly<Record<string, ComponentType<FieldComponentProps>>>;
  /** Replace the list or edit view of a collection, by slug. */
  views?: Readonly<
    Record<string, { list?: ComponentType<ViewProps>; edit?: ComponentType<ViewProps> }>
  >;
  /** Custom pages inside the admin shell. */
  pages?: readonly AdminPageDefinition[];
  /** Extra sidebar links. */
  nav?: readonly AdminNavItem[];
  /**
   * Components shown at the top of the sidebar, under the title, in extension order. For
   * example an organization switcher.
   */
  sidebar?: readonly ComponentType<SidebarProps>[];
  /** Message catalogs of the extension, one namespace each. See `defineMessages`. */
  catalogs?: readonly MessageBundle[];
}

/**
 * How much of the admin layout `createAdminPage` renders. `full` (default): sidebar, header
 * and page. `none`: only the page, for a host app that brings its own layout and navigation.
 */
export type AdminChrome = "full" | "none";

/**
 * Whether pages show their own title (`<h1>`). `render` (default) shows it. `none` hides it,
 * for a host layout that shows the title itself: read it from `getAdminNav(…).page`.
 */
export type AdminPageTitle = "render" | "none";

/** Options of `createAdminPage`. */
export interface AdminOptions extends AdminExtension, AdminI18nOptions {
  /** Layout around pages. Default `full`. Use `none` to embed pages in your own layout. */
  chrome?: AdminChrome;
  /**
   * Page titles: `render` (default) or `none`. With `none`, the `<h1>` of the dashboard,
   * collection pages and plugin pages is not shown; breadcrumbs, descriptions and actions stay.
   */
  pageTitle?: AdminPageTitle;
  /** URL path of the admin route. Default `/admin`. */
  basePath?: string;
  /**
   * URL path of the `@quickben/next` route handlers, for previews and downloads of file
   * fields. Default `/api`.
   */
  apiBasePath?: string;
  /** Extensions from plugins, applied before the options above. */
  extensions?: readonly AdminExtension[];
  /** Link shown to anonymous users who cannot read anything. */
  signInHref?: string;
  /**
   * Server function for saves, deletes and relation searches. Define it in the page file so
   * it can always reach your config, also right after a restart:
   *
   * ```tsx
   * async function serverFunction(request: AdminRequest) {
   *   "use server";
   *   return handleAdminRequest(config, request);
   * }
   * export default createAdminPage(config, { serverFunction });
   * ```
   *
   * Without it the admin uses a built-in server function that works once the page module
   * has loaded in the server process. Fine for development; pass your own in production.
   */
  serverFunction?: AdminServerFunction;
}

/** The merged extensions of an admin instance. */
export interface ResolvedExtensions {
  components: Record<string, ComponentType<FieldComponentProps>>;
  views: Record<string, { list?: ComponentType<ViewProps>; edit?: ComponentType<ViewProps> }>;
  pages: AdminPageDefinition[];
  nav: AdminNavItem[];
  sidebar: ComponentType<SidebarProps>[];
  catalogs: MessageBundle[];
}

/** An option of a relation picker. */
export interface RelationOption {
  id: string;
  label: string;
}

/** A request from the admin UI to the server. */
export type AdminRequest =
  | { type: "save"; slug: string; id: string | null; formData: FormData }
  | { type: "delete"; slug: string; id: string }
  | { type: "search"; slug: string; query: string };

/** Answer to an {@link AdminRequest}. */
export type AdminResult =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; fieldErrors: Record<string, string> }
  | { status: "options"; options: RelationOption[] };

/** A server function (`"use server"`) that runs admin requests: see `handleAdminRequest`. */
export type AdminServerFunction = (request: AdminRequest) => Promise<AdminResult>;
