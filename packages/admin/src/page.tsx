import { getQuickben, localize, QuickbenError } from "@quickben/core";
import { getMeta, getRequestContext } from "@quickben/next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { defaultServerFunction } from "./actions";
import { assertMessages, assertPages, normalizeBasePath, resolveExtensions } from "./extensions";
import { DEFAULT_API_BASE_PATH, fileUrls } from "./files";
import { resolveAdminI18nData } from "./i18n/resolve";
import { createAdminI18n } from "./i18n/translator";
import { listQuery, parseListState } from "./list-query";
import { loadCounts, loadRelationOptions } from "./load";
import { buildNav } from "./nav";
import { registerAdmin } from "./registry";
import { resolveRoute } from "./route";
import { themeStyle } from "./theme";
import { Toast } from "./ui/toast";
import { Dashboard } from "./views/dashboard";
import { EditView } from "./views/edit-view";
import { ListView } from "./views/list-view";
import { NotAllowed } from "./views/panels";
import { AdminFrame, Shell } from "./views/shell";

import type { AdminI18n } from "./i18n/translator";
import type { AdminRoute } from "./route";
import type { AdminTheme } from "./theme";
import type { AdminOptions, AdminServerFunction, ResolvedExtensions, SearchParams } from "./types";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { CollectionMeta, MetaResponse } from "@quickben/next";
import type { ReactElement, ReactNode } from "react";

export { resolveRoute } from "./route";
export type { AdminRoute } from "./route";

/** Props Next.js passes to `app/admin/[[...segments]]/page.tsx`. */
export interface AdminPageProps {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<SearchParams>;
}

/** `?toast=` codes of the admin and their messages. */
const toasts = {
  created: "toast.created",
  saved: "toast.saved",
  deleted: "toast.deleted",
} as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface RenderArgs {
  serverFunction: AdminServerFunction;
  basePath: string;
  apiBasePath: string;
  extensions: ResolvedExtensions;
  signInHref: string | undefined;
  qb: Quickben;
  ctx: RequestContext;
  meta: MetaResponse;
  route: AdminRoute;
  searchParams: SearchParams;
  i18n: AdminI18n;
}

async function renderDashboard(args: RenderArgs): Promise<ReactNode> {
  const { qb, ctx, meta, basePath, extensions, i18n } = args;
  if (meta.collections.length === 0 && ctx.user === null) {
    return (
      <NotAllowed
        signedIn={false}
        signInHref={args.signInHref}
        message={i18n.t("access.signInToUse")}
        i18n={i18n}
      />
    );
  }
  const metas = new Map(meta.collections.map((collection) => [collection.slug, collection]));
  const counts = await loadCounts(qb, ctx, [...metas.keys()]);
  return (
    <Dashboard
      title={meta.title}
      basePath={basePath}
      groups={buildNav(meta, extensions, basePath, i18n)}
      collections={metas}
      counts={counts}
      configured={Object.values(qb.collections).some(
        (collection) => collection.admin.hidden !== true,
      )}
      i18n={i18n}
    />
  );
}

async function renderContent(args: RenderArgs): Promise<ReactNode> {
  const { qb, ctx, meta, route, basePath, serverFunction, extensions, searchParams, i18n } = args;
  const metas = new Map(meta.collections.map((collection) => [collection.slug, collection]));
  if (route.kind === "notFound") notFound();
  if (route.kind === "page") {
    const Page = route.page.component;
    return (
      <Page
        user={ctx.user}
        basePath={basePath}
        segments={route.segments}
        searchParams={searchParams}
        i18n={i18n}
        serverFunction={serverFunction}
      />
    );
  }
  if (route.kind === "dashboard") return renderDashboard(args);
  const collection = metas.get(route.slug);
  if (!collection) {
    const label = qb.collections[route.slug]?.labels.plural;
    return (
      <NotAllowed
        signedIn={ctx.user !== null}
        signInHref={args.signInHref}
        message={i18n.t("access.collection", {
          collection: label === undefined ? route.slug : localize(label, i18n.locale),
        })}
        i18n={i18n}
      />
    );
  }
  const views = extensions.views[route.slug];
  const viewProps = { collection, user: ctx.user, basePath, searchParams, i18n };
  if (route.kind === "list") {
    if (views?.list) {
      const View = views.list;
      return <View {...viewProps} />;
    }
    const state = parseListState(collection, searchParams);
    const result = await qb.find(route.slug, listQuery(collection, state) as never, ctx);
    return (
      <ListView
        collection={collection}
        basePath={basePath}
        state={state}
        result={result}
        metas={metas}
        i18n={i18n}
      />
    );
  }
  const id = route.kind === "edit" ? route.id : undefined;
  if (views?.edit) {
    const View = views.edit;
    return <View {...viewProps} {...(id === undefined ? {} : { id })} />;
  }
  const doc = id === undefined ? null : await qb.findById(route.slug, id, {}, ctx);
  const relationOptions = await loadRelationOptions(qb, ctx, collection, doc, metas);
  const labels = Object.fromEntries(meta.collections.map((c) => [c.slug, c.labels.plural]));
  const files = fileUrls(args.apiBasePath, collection.slug, doc, collection.fields);
  return (
    <EditView
      collection={collection}
      basePath={basePath}
      doc={doc}
      serverFunction={serverFunction}
      context={{ components: extensions.components, relationOptions, labels, files }}
      i18n={i18n}
    />
  );
}

function isAccessError(error: unknown): error is QuickbenError {
  return (
    error instanceof QuickbenError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")
  );
}

function currentKey(route: AdminRoute): string | null {
  switch (route.kind) {
    case "page":
      return route.page.path;
    case "list":
    case "create":
    case "edit":
      return route.slug;
    default:
      return null;
  }
}

function toastFor(
  route: AdminRoute,
  searchParams: SearchParams,
  metas: ReadonlyMap<string, CollectionMeta>,
  i18n: AdminI18n,
) {
  const kind = first(searchParams.toast);
  if (kind === undefined || !Object.hasOwn(toasts, kind)) return null;
  const singular =
    ("slug" in route ? metas.get(route.slug)?.labels.singular : undefined) ??
    i18n.t("document.fallback");
  return (
    <Toast message={i18n.t(toasts[kind as keyof typeof toasts], { singular })} param="toast" />
  );
}

/**
 * Create the admin page for `app/admin/[[...segments]]/page.tsx`:
 *
 * ```tsx
 * import config from "@/quickben.config";
 * import { createAdminPage } from "@quickben/admin";
 *
 * export default createAdminPage(config);
 * ```
 *
 * It is a server component. Routes: the dashboard, `/:collection` (list),
 * `/:collection/new`, `/:collection/:id` (edit) and custom pages. Every read and write goes
 * through the local API with the user from `config.auth`, so access rules apply.
 * Import `@quickben/admin/styles.css` once, e.g. in `app/admin/layout.tsx`.
 *
 * With `chrome: "none"` it renders only the page, without sidebar and header, so it can sit
 * inside your own layout at any `basePath`. Build your navigation with `getAdminNav`.
 *
 * The content reads the request (params, search params, headers) and the database, so it
 * renders inside `<Suspense>`. That makes the page work with `cacheComponents: true`, where
 * the fallback is the prerendered shell, and without it.
 */
export function createAdminPage(
  config: QuickbenConfig,
  options: AdminOptions = {},
): (props: Readonly<AdminPageProps>) => ReactElement {
  const AdminContent = createAdminContent(config, options);
  const embedded = options.chrome === "none";
  function AdminPage(props: Readonly<AdminPageProps>): ReactElement {
    return (
      <Suspense fallback={<AdminFallback embedded={embedded} theme={options.theme} />}>
        <AdminContent {...props} />
      </Suspense>
    );
  }
  return AdminPage;
}

function AdminFallback({
  embedded,
  theme,
}: Readonly<{ embedded: boolean; theme: AdminTheme | undefined }>): ReactElement {
  return (
    <div
      className={embedded ? "qb-root" : "qb-root qb:min-h-screen qb:bg-surface-muted"}
      style={themeStyle(theme)}
      aria-busy="true"
    />
  );
}

/** The async server component inside {@link createAdminPage}'s `<Suspense>`. */
export function createAdminContent(
  config: QuickbenConfig,
  options: AdminOptions = {},
): (props: Readonly<AdminPageProps>) => Promise<ReactElement> {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const extensions = resolveExtensions(options);
  assertPages(config, extensions);
  assertMessages(extensions);
  const instance = { config, basePath, i18n: options };
  const key = registerAdmin(instance);
  const serverFunction: AdminServerFunction =
    options.serverFunction ?? defaultServerFunction.bind(null, key);
  const slugs = new Set(config.collections.map((collection) => collection.slug));

  async function AdminContent(props: Readonly<AdminPageProps>): Promise<ReactElement> {
    const [{ segments = [] }, searchParams] = await Promise.all([props.params, props.searchParams]);
    // Register again on render: after a dev reload the latest config wins.
    registerAdmin(instance);
    // Read the request before the database: with `cacheComponents`, this ends the prerender
    // here, so the database is never opened while prerendering.
    const ctx = await getRequestContext(config);
    const i18nData = await resolveAdminI18nData(config, options, ctx.req);
    const i18n = createAdminI18n(i18nData);
    const qb = await getQuickben(config);
    const meta = await getMeta(qb, ctx, { locale: i18n.locale });
    const route = resolveRoute(segments.map(decodeURIComponent), slugs, extensions.pages);
    const metas = new Map(meta.collections.map((collection) => [collection.slug, collection]));
    let content: ReactNode;
    try {
      content = await renderContent({
        serverFunction,
        basePath,
        extensions,
        signInHref: options.signInHref,
        apiBasePath: options.apiBasePath ?? DEFAULT_API_BASE_PATH,
        qb,
        ctx,
        meta,
        route,
        searchParams,
        i18n,
      });
    } catch (error) {
      if (isAccessError(error)) {
        content = (
          <NotAllowed
            signedIn={ctx.user !== null}
            signInHref={options.signInHref}
            message={error.message}
            i18n={i18n}
          />
        );
      } else if (error instanceof QuickbenError && error.code === "NOT_FOUND") {
        notFound();
      } else {
        throw error;
      }
    }
    const toast = toastFor(route, searchParams, metas, i18n);
    if (options.chrome === "none") {
      return (
        <AdminFrame i18n={i18n} pageTitle={options.pageTitle} theme={options.theme}>
          {content}
          {toast}
        </AdminFrame>
      );
    }
    const current = currentKey(route);
    return (
      <Shell
        title={meta.title}
        basePath={basePath}
        groups={buildNav(meta, extensions, basePath, i18n, current)}
        current={current}
        user={ctx.user}
        i18n={i18n}
        pageTitle={options.pageTitle}
        theme={options.theme}
        logo={options.logo}
        sidebarTop={
          extensions.sidebar.length > 0
            ? extensions.sidebar.map((Sidebar, index) => (
                <Sidebar key={String(index)} user={ctx.user} basePath={basePath} i18n={i18n} />
              ))
            : null
        }
      >
        {content}
        {toast}
      </Shell>
    );
  }
  return AdminContent;
}
