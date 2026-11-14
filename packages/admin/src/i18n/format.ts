import type { AdminMessage } from "@quickben/core";

/** Values for `{name}` placeholders. Numbers are formatted for the locale. */
export type MessageValues = Readonly<Record<string, string | number>>;

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/** A cached `Intl.NumberFormat` without options. */
export function numberFormat(locale: string): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

/** Pick the plural form for `values.count` with `Intl.PluralRules`. */
function pickForm(message: AdminMessage, locale: string, values: MessageValues): string {
  if (typeof message === "string") return message;
  const count = values.count;
  if (typeof count !== "number") return message.other;
  return message[rulesFor(locale).select(count)] ?? message.other;
}

/**
 * Format a message: choose the plural form, then replace `{name}` placeholders. Unknown
 * placeholders stay as they are.
 */
export function formatMessage(
  message: AdminMessage,
  locale: string,
  values: MessageValues = {},
): string {
  const text = pickForm(message, locale, values);
  return text.replaceAll(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(values, name)) return whole;
    const value = values[name];
    return typeof value === "number" ? numberFormat(locale).format(value) : String(value);
  });
}
