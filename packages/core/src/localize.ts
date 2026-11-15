/**
 * Text shown to people: one string, or one string per locale.
 *
 * ```ts
 * labels: { singular: "Post", plural: { en: "Posts", es: "Entradas" } }
 * ```
 */
export type LocalizedText = string | Readonly<Record<string, string>>;

/** Locale used when a text has no value for the requested locale. */
export const defaultLocale = "en";

/**
 * Locales to try for `locale`, most specific first: `es-CL` gives `["es-CL", "es", "en"]`.
 * Invalid tags are kept as given.
 */
export function localeChain(locale: string | undefined): string[] {
  const chain: string[] = [];
  const add = (tag: string) => {
    if (tag !== "" && !chain.includes(tag)) chain.push(tag);
  };
  if (locale) {
    add(locale);
    const parts = locale.split("-");
    for (let end = parts.length - 1; end > 0; end -= 1) add(parts.slice(0, end).join("-"));
  }
  add(defaultLocale);
  return chain;
}

/**
 * The text for `locale`. Per-locale records fall back to the language (`es-CL` → `es`), then
 * English, then their first value. `undefined` gives `""`.
 */
export function localize(text: LocalizedText | undefined, locale?: string): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  for (const tag of localeChain(locale)) {
    const value = Object.hasOwn(text, tag) ? text[tag] : undefined;
    if (value !== undefined) return value;
  }
  return Object.values(text)[0] ?? "";
}

/** Apply `fn` to a text, per locale for records. */
export function mapLocalized(text: LocalizedText, fn: (value: string) => string): LocalizedText {
  const mapped: LocalizedText =
    typeof text === "string"
      ? fn(text)
      : Object.fromEntries(Object.entries(text).map(([locale, value]) => [locale, fn(value)]));
  return mapped;
}

function languageOf(tag: string): string {
  return tag.split("-")[0]?.toLowerCase() ?? "";
}

/**
 * Pick a locale from an `Accept-Language` header. A tag whose language is supported is kept
 * as sent (`es-CL` when `es` is supported), so dates and numbers follow the region.
 *
 * ```ts
 * negotiateLocale("es-CL,es;q=0.9,en;q=0.8", ["en", "es"]); // "es-CL"
 * ```
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  supported: readonly string[],
  fallback: string = supported[0] ?? defaultLocale,
): string {
  const requested = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.trim().slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of requested) {
    const exact = supported.find((candidate) => candidate.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    if (supported.some((candidate) => languageOf(candidate) === languageOf(tag))) return tag;
  }
  return fallback;
}

/** Options of {@link localeFromRequest}. */
export interface LocaleFromRequestOptions {
  /** Locales the app offers, e.g. `["en", "es"]`. The first is the default. */
  supported: readonly string[];
  /** Cookie that holds a chosen locale. It wins over `Accept-Language` when supported. */
  cookie?: string;
  /** Locale when nothing matches. Default: the first supported locale. */
  fallback?: string;
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * A locale resolver for `admin.locale`: the cookie, then `Accept-Language`, then the fallback.
 *
 * ```ts
 * admin: { locale: localeFromRequest({ supported: ["en", "es"], cookie: "locale" }) }
 * ```
 */
export function localeFromRequest(
  options: LocaleFromRequestOptions,
): (req: Request | undefined) => string {
  const fallback = options.fallback ?? options.supported[0] ?? defaultLocale;
  return (req) => {
    if (!req) return fallback;
    if (options.cookie) {
      const chosen = cookieValue(req.headers.get("cookie"), options.cookie);
      if (chosen) {
        const match = negotiateLocale(chosen, options.supported, "");
        if (match !== "") return match;
      }
    }
    return negotiateLocale(req.headers.get("accept-language"), options.supported, fallback);
  };
}
