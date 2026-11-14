import { localeFromRequest } from "@quickben/core";

import type { AdminLocale } from "@quickben/core";

/** Locales the playground offers. */
export const playgroundLocales = ["en", "es"] as const;

/** Cookie that holds a chosen locale. */
export const localeCookie = "quickben-locale";

/**
 * Admin locale. `QUICKBEN_LOCALE=es` fixes it; without it the cookie, then `Accept-Language`,
 * then English.
 */
export const playgroundLocale: AdminLocale =
  process.env.QUICKBEN_LOCALE ??
  localeFromRequest({ supported: playgroundLocales, cookie: localeCookie });
