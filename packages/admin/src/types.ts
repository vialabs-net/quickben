import type { NavItem, QuickbenUser } from "@quickben/core";
import type { CollectionMeta, FieldMeta } from "@quickben/next";
import type { ComponentType } from "react";

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
}

/** Props of a custom list or edit view. */
export interface ViewProps {
  collection: CollectionMeta;
  user: QuickbenUser | null;
  basePath: string;
  searchParams: SearchParams;
  /** Document id, for edit views of existing documents. */
  id?: string;
}

/** Props of a custom admin page. */
export interface PageProps {
  user: QuickbenUser | null;
  basePath: string;
  /** Path segments after the page path: `/admin/reports/2024` gives `["2024"]`. */
  segments: string[];
  searchParams: SearchParams;
}

/** Props of a sidebar component. */
export interface SidebarProps {
  user: QuickbenUser | null;
  basePath: string;
}

/** A custom page inside the admin shell, at `<basePath>/<path>`. */
export interface AdminPageDefinition {
  /** First path segment. Lowercase letters, digits and `-`. Must not be a collection slug. */
  path: string;
  label: string;
  /** Sidebar group. Default `Pages`. */
  group?: string;
  component: ComponentType<PageProps>;
}

/** Extra sidebar link. */
export type AdminNavItem = NavItem & { group?: string };

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
}

/** Options of `createAdminPage`. */
export interface AdminOptions extends AdminExtension {
  /** URL path of the admin route. Default `/admin`. */
  basePath?: string;
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
