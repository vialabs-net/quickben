import type { AdminPageDefinition } from "./types";

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
