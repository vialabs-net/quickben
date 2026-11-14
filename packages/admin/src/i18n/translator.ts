import { formatDateValue, localeChain, localize } from "@quickben/core";

import { formatMessage } from "./format";
import { adminMessages } from "./messages";

import type { MessageBundle, MessageKey } from "./catalog";
import type { MessageValues } from "./format";
import type { AdminMessage, LocalizedText } from "@quickben/core";

/** Keys of the admin's own messages, without the `admin.` namespace. */
export type AdminMessageKey = MessageKey<typeof adminMessages>;

/**
 * What the admin needs to translate on the server and in the browser. Plain data, so it can be
 * passed to client components.
 */
export interface AdminI18nData {
  /** BCP 47 locale, such as `es-CL`. */
  locale: string;
  /** IANA time zone for dates and times. */
  timeZone: string;
  /** Overrides for this locale, by full key (`namespace.key`), already resolved per locale. */
  overrides: Readonly<Record<string, AdminMessage>>;
}

/** Translate the messages of one namespace. */
export interface Translator<K extends string = string> {
  readonly locale: string;
  /** The message for `key`, with `{name}` placeholders replaced and plurals chosen by `count`. */
  t: (key: K, values?: MessageValues) => string;
}

/** Input of date helpers: an ISO string, a `YYYY-MM-DD` date, a `Date` or a timestamp. */
export type DateInput = string | number | Date;

/** Translation and formatting for the active locale. Given to pages, views and sidebars. */
export interface AdminI18n extends Translator<AdminMessageKey> {
  readonly timeZone: string;
  /** The plain data, for client components and {@link createAdminI18n}. */
  readonly data: AdminI18nData;
  /** A translator for a plugin's or app's own messages. */
  scope<B extends MessageBundle>(bundle: B): Translator<MessageKey<B>>;
  /** A label given as a string or per locale. */
  text(value: LocalizedText | null | undefined): string;
  /** Lower case for the locale, for labels inside sentences. */
  lower(text: string): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** A date. `YYYY-MM-DD` strings are calendar dates and never shift by time zone. */
  date(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** A date and time in {@link AdminI18n.timeZone}, with the zone name. */
  dateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** `3 days ago`, `in 2 hours`, `yesterday`. */
  relativeTime(value: DateInput, now?: DateInput): string;
  /** `a, b and c` for the locale. */
  list(items: readonly string[], type?: "conjunction" | "disjunction"): string;
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" && dateOnly.test(value)) return new Date(`${value}T00:00:00Z`);
  return new Date(value);
}

const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The override, then the bundle's message for the locale chain. */
function lookup(data: AdminI18nData, bundle: MessageBundle, key: string): AdminMessage | undefined {
  const locales: Readonly<Record<string, Readonly<Record<string, AdminMessage | undefined>>>> =
    bundle.locales;
  const candidates = [
    own(data.overrides, `${bundle.namespace}.${key}`),
    ...localeChain(data.locale).map((tag) => own(own(locales, tag), key)),
  ];
  const found = candidates.find((message) => message !== undefined);
  return found;
}

function translator<K extends string>(data: AdminI18nData, bundle: MessageBundle): Translator<K> {
  return {
    locale: data.locale,
    t: (key, values) => {
      const message = lookup(data, bundle, key);
      return message === undefined
        ? `${bundle.namespace}.${key}`
        : formatMessage(message, data.locale, values);
    },
  };
}

/** `Jan 2, 2026, 10:30 AM UTC`: medium date, short time and the zone name. */
const defaultDateTime: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/** Build the translator for some {@link AdminI18nData}. Works on the server and in the browser. */
export function createAdminI18n(data: AdminI18nData): AdminI18n {
  const { locale, timeZone } = data;
  const own = translator<AdminMessageKey>(data, adminMessages);
  return {
    locale,
    timeZone,
    data,
    t: own.t,
    scope: (bundle) => translator(data, bundle),
    text: (value) => (value === null || value === undefined ? "" : localize(value, locale)),
    lower: (text) => text.toLocaleLowerCase(locale),
    number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    date: (value, options = { dateStyle: "medium" }) =>
      formatDateValue(value, { ...options, type: "date", locale, timeZone }),
    dateTime: (value, options = defaultDateTime) =>
      formatDateValue(value, { ...options, type: "datetime", locale, timeZone }),
    relativeTime(value, now = Date.now()) {
      const seconds = (toDate(value).getTime() - toDate(now).getTime()) / 1000;
      if (Number.isNaN(seconds)) return String(value);
      const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const [unit, size] = units.find(([, length]) => Math.abs(seconds) >= length) ?? ["second", 1];
      return format.format(Math.round(seconds / size), unit);
    },
    list: (items, type = "conjunction") =>
      new Intl.ListFormat(locale, { style: "long", type }).format(items),
  };
}

/** English with no overrides: the default when no admin page provides a locale. */
export const englishI18n: AdminI18n = createAdminI18n({
  locale: "en",
  timeZone: "UTC",
  overrides: {},
});
