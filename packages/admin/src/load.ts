import { documentTitle } from "./format";

import type { RelationOption } from "./types";
import type { Quickben, RequestContext } from "@quickben/core";
import type { CollectionMeta } from "@quickben/next";

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string");
  return typeof value === "string" ? [value] : [];
}

/**
 * Labels of the documents selected in each relation field of `doc`. Documents the user
 * cannot read, or that no longer exist, are labelled with their id.
 */
export async function loadRelationOptions(
  qb: Quickben,
  ctx: RequestContext,
  collection: CollectionMeta,
  doc: Record<string, unknown> | null,
  metas: ReadonlyMap<string, CollectionMeta>,
): Promise<Record<string, RelationOption[]>> {
  const entries = await Promise.all(
    collection.fields
      .filter((field) => field.type === "relation")
      .map(async (field) => {
        const ids = idsOf(doc?.[field.name]);
        const related = field.to ? metas.get(field.to) : undefined;
        const labels = new Map<string, string>();
        if (ids.length > 0 && related) {
          try {
            const found = await qb.find(
              related.slug,
              { where: { id: { in: ids } }, limit: ids.length },
              ctx,
            );
            for (const item of found.docs) labels.set(item.id, documentTitle(related, item));
          } catch {
            // Fall back to ids.
          }
        }
        return [field.name, ids.map((id) => ({ id, label: labels.get(id) ?? id }))] as const;
      }),
  );
  return Object.fromEntries(entries);
}

/** Document count per collection. A collection that fails to count is left out. */
export async function loadCounts(
  qb: Quickben,
  ctx: RequestContext,
  slugs: readonly string[],
): Promise<Record<string, number>> {
  const counts = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return [slug, await qb.count(slug, {}, ctx)] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(counts.filter((entry) => entry !== null));
}
