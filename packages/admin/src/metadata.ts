import { localize } from "@quickben/core";

import { createAdminI18n } from "./i18n/translator";

import type { QuickbenConfig } from "@quickben/core";
import type { Metadata } from "next";

/**
 * Metadata for the admin route. Export it from `app/admin/layout.tsx` (or the page):
 *
 * ```ts
 * export const metadata = generateAdminMetadata(config);
 * ```
 *
 * The title is `admin.meta.title`, default `Admin · <admin.title>` (from the `admin.meta.title`
 * message). Search engines are told not to index the admin. Pass `locale` for labels given
 * per locale; it defaults to `admin.locale` when that is a string.
 */
export function generateAdminMetadata(
  config: QuickbenConfig,
  options: { locale?: string } = {},
): Metadata {
  const { title, meta } = config.admin;
  const configured = typeof config.admin.locale === "string" ? config.admin.locale : undefined;
  const locale = options.locale ?? configured ?? "en";
  const i18n = createAdminI18n({ locale, timeZone: "UTC", overrides: {} });
  const resolved =
    meta.title === undefined
      ? i18n.t("meta.title", { title: localize(title, locale) })
      : localize(meta.title, locale);
  return {
    // `absolute` ignores a title template of the root layout.
    title: { absolute: resolved },
    ...(meta.description === undefined ? {} : { description: localize(meta.description, locale) }),
    robots: { index: false, follow: false },
  };
}
