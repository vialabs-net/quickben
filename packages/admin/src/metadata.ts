import type { QuickbenConfig } from "@quickben/core";
import type { Metadata } from "next";

/**
 * Metadata for the admin route. Export it from `app/admin/layout.tsx` (or the page):
 *
 * ```ts
 * export const metadata = generateAdminMetadata(config);
 * ```
 *
 * The title is `admin.meta.title`, default `Admin · <admin.title>`. Search engines are told
 * not to index the admin.
 */
export function generateAdminMetadata(config: QuickbenConfig): Metadata {
  const { title, meta } = config.admin;
  return {
    // `absolute` ignores a title template of the root layout.
    title: { absolute: meta.title ?? `Admin · ${title}` },
    ...(meta.description === undefined ? {} : { description: meta.description }),
    robots: { index: false, follow: false },
  };
}
