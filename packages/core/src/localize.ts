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
