import { defaultLocale, localeChain } from "@quickben/core";

import type { AdminI18nData } from "./translator";
import type {
  AdminLocale,
  AdminMessage,
  AdminMessageOverrides,
  QuickbenConfig,
} from "@quickben/core";

/** Locale options of `createAdminPage`. They win over `admin.locale` and friends in the config. */
export interface AdminI18nOptions {
  /** Locale, or a function of the request. Default: `admin.locale` in the config, then `en`. */
  locale?: AdminLocale;
  /** Message overrides by locale and full key, merged over `admin.messages` in the config. */
  messages?: AdminMessageOverrides;
  /** IANA time zone for dates and times. Default: `admin.timeZone`, then `UTC`. */
  timeZone?: string;
}

/** A valid BCP 47 tag in canonical form, or `null`. */
export function canonicalLocale(tag: string | undefined): string | null {
  if (!tag) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

function validTimeZone(zone: string | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** Resolve the admin locale for a request: options, then config, then `en`. */
export async function resolveAdminLocale(
  config: QuickbenConfig,
  options: AdminI18nOptions,
  req: Request | undefined,
): Promise<string> {
  const setting = options.locale ?? config.admin.locale;
  const value = typeof setting === "function" ? await setting(req) : setting;
  return canonicalLocale(value) ?? defaultLocale;
}

/** Flatten overrides for one locale: the most specific tag wins (`es-CL` over `es` over `en`). */
export function flattenOverrides(
  locale: string,
  sources: readonly (AdminMessageOverrides | undefined)[],
): Record<string, AdminMessage> {
  const flat: Record<string, AdminMessage> = {};
  for (const tag of localeChain(locale).reverse()) {
    for (const source of sources) {
      const messages = source && Object.hasOwn(source, tag) ? source[tag] : undefined;
      if (messages) Object.assign(flat, messages);
    }
  }
  return flat;
}

/** The {@link AdminI18nData} of a request. */
export async function resolveAdminI18nData(
  config: QuickbenConfig,
  options: AdminI18nOptions,
  req: Request | undefined,
): Promise<AdminI18nData> {
  const locale = await resolveAdminLocale(config, options, req);
  return {
    locale,
    timeZone: validTimeZone(options.timeZone ?? config.admin.timeZone),
    overrides: flattenOverrides(locale, [config.admin.messages, options.messages]),
  };
}
