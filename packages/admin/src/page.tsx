import { getQuickben, QuickbenError } from "@quickben/core";
import { getMeta, getRequestContext } from "@quickben/next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { defaultServerFunction } from "./actions";
import { assertPages, normalizeBasePath, resolveExtensions } from "./extensions";
import { listQuery, parseListState } from "./list-query";
import { loadCounts, loadRelationOptions } from "./load";
import { buildNav } from "./nav";
import { registerAdmin } from "./registry";
import { Toast } from "./ui/toast";
import { Dashboard } from "./views/dashboard";
import { EditView } from "./views/edit-view";
import { ListView } from "./views/list-view";
import { NotAllowed } from "./views/panels";
import { Shell } from "./views/shell";

import type {
  AdminOptions,
  AdminPageDefinition,
  AdminServerFunction,
  ResolvedExtensions,
  SearchParams,
} from "./types";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { CollectionMeta, MetaResponse } from "@quickben/next";
import type { ReactElement, ReactNode } from "react";

/** Props Next.js passes to `app/admin/[[...segments]]/page.tsx`. */
export interface AdminPageProps {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<SearchParams>;
}

/** Where a URL inside the admin points. */
export type AdminRoute =
  | { kind: "dashboard" }
  | { kind: "list"; slug: string }
  | { kind: "create"; slug: string }
  | { kind: "edit"; slug: string; id: string }
  | { kind: "page"; page: AdminPageDefinition; segments: string[] }
  | { kind: "notFound" };

/** Resolve the path segments after the base path. */
export function resolveRoute(
  segments: readonly string[],
  slugs: ReadonlySet<string>,
  pages: readonly AdminPageDefinition[],
): AdminRoute {
  const [first, second, ...rest] = segments;
  if (first === undefined) return { kind: "dashboard" };
  const page = pages.find((candidate) => candidate.path === first);
  if (page) return { kind: "page", page, segments: segments.slice(1) };
  if (!slugs.has(first) || rest.length > 0) return { kind: "notFound" };
  if (second === undefined) return { kind: "list", slug: first };
  if (second === "new") return { kind: "create", slug: first };
  return { kind: "edit", slug: first, id: second };
}

const toasts: Record<string, (singular: string) => string> = {
  created: (singular) => `${singular} created`,
  saved: () => "Changes saved",
  deleted: (singular) => `${singular} deleted`,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface RenderArgs {
  serverFunction: AdminServerFunction;
  basePath: string;
  extensions: ResolvedExtensions;
  signInHref: string | undefined;
  qb: Quickben;
  ctx: RequestContext;
  meta: MetaResponse;
  route: AdminRoute;
  searchParams: SearchParams;
}

async function renderContent(args: RenderArgs): Promise<ReactNode> {
  const { qb, ctx, meta, route, basePath, serverFunction, extensions, searchParams } = args;
  const metas = new Map(meta.collections.map((collection) => [collection.slug, collection]));
  const signedIn = ctx.user !== null;
  if (route.kind === "notFound") notFound();
  if (route.kind === "page") {
    const Page = route.page.component;
    return (
      <Page
        user={ctx.user}
        basePath={basePath}
        segments={route.segments}
        searchParams={searchParams}
      />
    );
  }
  if (route.kind === "dashboard") {
    if (meta.collections.length === 0 && !signedIn) {
      return (
        <NotAllowed
          signedIn={false}
          signInHref={args.signInHref}
          message="Sign in to use the admin."
        />
      );
    }
    const groups = buildNav(meta, extensions, basePath);
    const counts = await loadCounts(qb, ctx, [...metas.keys()]);
    return (
      <Dashboard
        title={meta.title}
        basePath={basePath}
        groups={groups}
        collections={metas}
        counts={counts}
      />
    );
  }
  const collection = metas.get(route.slug);
  if (!collection) {
    return (
      <NotAllowed
        signedIn={signedIn}
        signInHref={args.signInHref}
        message={`You cannot access ${qb.collections[route.slug]?.labels.plural ?? route.slug}.`}
      />
    );
  }
  const views = extensions.views[route.slug];
  if (route.kind === "list") {
    if (views?.list) {
      const View = views.list;
      return (
        <View
          collection={collection}
          user={ctx.user}
          basePath={basePath}
          searchParams={searchParams}
        />
      );
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
      />
    );
  }
  const id = route.kind === "edit" ? route.id : undefined;
  if (views?.edit) {
    const View = views.edit;
    return (
      <View
        collection={collection}
        user={ctx.user}
        basePath={basePath}
        searchParams={searchParams}
        {...(id === undefined ? {} : { id })}
      />
    );
  }
  const doc = id === undefined ? null : await qb.findById(route.slug, id, {}, ctx);
  const relationOptions = await loadRelationOptions(qb, ctx, collection, doc, metas);
  const labels = Object.fromEntries(meta.collections.map((c) => [c.slug, c.labels.plural]));
  return (
    <EditView
      collection={collection}
      basePath={basePath}
      doc={doc}
      serverFunction={serverFunction}
      context={{ components: extensions.components, relationOptions, labels }}
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
) {
  const kind = first(searchParams.toast);
  const message = kind === undefined ? undefined : toasts[kind];
  if (!message) return null;
  const singular =
    "slug" in route ? (metas.get(route.slug)?.labels.singular ?? "Document") : "Document";
  return <Toast message={message(singular)} param="toast" />;
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
 * The content reads the request (params, search params, headers) and the database, so it
 * renders inside `<Suspense>`. That makes the page work with `cacheComponents: true`, where
 * the fallback is the prerendered shell, and without it.
 */
export function createAdminPage(
  config: QuickbenConfig,
  options: AdminOptions = {},
): (props: Readonly<AdminPageProps>) => ReactElement {
  const AdminContent = createAdminContent(config, options);
  function AdminPage(props: Readonly<AdminPageProps>): ReactElement {
    return (
      <Suspense fallback={<AdminFallback />}>
        <AdminContent {...props} />
      </Suspense>
    );
  }
  return AdminPage;
}

function AdminFallback(): ReactElement {
  return <div className="qb-root qb:min-h-screen qb:bg-zinc-50" aria-busy="true" />;
}

/** The async server component inside {@link createAdminPage}'s `<Suspense>`. */
export function createAdminContent(
  config: QuickbenConfig,
  options: AdminOptions = {},
): (props: Readonly<AdminPageProps>) => Promise<ReactElement> {
  const basePath = normalizeBasePath(options.basePath ?? "/admin");
  const extensions = resolveExtensions(options);
  assertPages(config, extensions);
  const key = registerAdmin({ config, basePath });
  const serverFunction: AdminServerFunction =
    options.serverFunction ?? defaultServerFunction.bind(null, key);
  const slugs = new Set(config.collections.map((collection) => collection.slug));

  async function AdminContent(props: Readonly<AdminPageProps>): Promise<ReactElement> {
    const [{ segments = [] }, searchParams] = await Promise.all([props.params, props.searchParams]);
    // Register again on render: after a dev reload the latest config wins.
    registerAdmin({ config, basePath });
    // Read the request before the database: with `cacheComponents`, this ends the prerender
    // here, so the database is never opened while prerendering.
    const ctx = await getRequestContext(config);
    const qb = await getQuickben(config);
    const meta = await getMeta(qb, ctx);
    const route = resolveRoute(segments.map(decodeURIComponent), slugs, extensions.pages);
    const metas = new Map(meta.collections.map((collection) => [collection.slug, collection]));
    let content: ReactNode;
    try {
      content = await renderContent({
        serverFunction,
        basePath,
        extensions,
        signInHref: options.signInHref,
        qb,
        ctx,
        meta,
        route,
        searchParams,
      });
    } catch (error) {
      if (isAccessError(error)) {
        content = (
          <NotAllowed
            signedIn={ctx.user !== null}
            signInHref={options.signInHref}
            message={error.message}
          />
        );
      } else if (error instanceof QuickbenError && error.code === "NOT_FOUND") {
        notFound();
      } else {
        throw error;
      }
    }
    return (
      <Shell
        title={meta.title}
        basePath={basePath}
        groups={buildNav(meta, extensions, basePath)}
        current={currentKey(route)}
        user={ctx.user}
        sidebarTop={
          extensions.sidebar.length > 0
            ? extensions.sidebar.map((Sidebar, index) => (
                <Sidebar key={String(index)} user={ctx.user} basePath={basePath} />
              ))
            : null
        }
      >
        {content}
        {toastFor(route, searchParams, metas)}
      </Shell>
    );
  }
  return AdminContent;
}
