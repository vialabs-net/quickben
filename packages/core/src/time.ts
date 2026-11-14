/**
 * Time zone helpers built on `Intl`. Nothing here reads the time zone of the server: every
 * conversion takes an IANA zone name.
 */

/** Time zone used when the config and the field set none. */
export const defaultTimeZone = "UTC";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
/** An ISO datetime that ends with `Z` or an offset. `Date` checks the rest. */
const offsetDateTimePattern = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-][\d:]+)$/i;

/** A value that `new Date(value)` reads as an instant. */
export type DateLike = Date | string | number;

const halfDay = 12 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter that gives the wall-clock parts of an instant in `timeZone`. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether `timeZone` is an IANA zone name that `Intl` knows. */
export function isTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== "string" || timeZone === "") return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallTime(instant: number, timeZone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east is positive). */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallTime(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/** The calendar date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function dateInTimeZone(value: DateLike, timeZone: string): string {
  const instant = new Date(value).getTime();
  const wall = wallTime(instant, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The wall-clock time of an instant in `timeZone`, as `YYYY-MM-DDTHH:mm` (for inputs). */
export function localDateTime(value: DateLike, timeZone: string): string {
  const instant = new Date(value).getTime();
  if (Number.isNaN(instant)) return "";
  const wall = wallTime(instant, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * The instant of a wall-clock time in `timeZone`, as an ISO 8601 UTC string. Accepts
 * `YYYY-MM-DD` (midnight), `YYYY-MM-DDTHH:mm` and `YYYY-MM-DDTHH:mm:ss`. A time skipped by a
 * daylight saving change moves forward by the size of the gap; a repeated time takes the
 * earlier instant. Returns `null` for other input.
 */
export function zonedTimeToUtc(local: string, timeZone: string): string | null {
  let text = datePattern.test(local) ? `${local}T00:00` : local;
  if (/T\d{2}:\d{2}$/.test(text)) text = `${text}:00`;
  const match = localDateTimePattern.exec(text);
  if (!match) return null;
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1) return null;
  if (check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  // Offsets in effect half a day before and after: one each side of any DST change.
  const before = asUtc - offsetAt(asUtc - halfDay, timeZone);
  const after = asUtc - offsetAt(asUtc + halfDay, timeZone);
  const valid = [before, after].filter(
    (instant) => offsetAt(instant, timeZone) === asUtc - instant,
  );
  // No valid instant: the time is in a gap. The offset before the gap moves it forward.
  return new Date(valid.length > 0 ? Math.min(...valid) : before).toISOString();
}

/** Options of {@link formatDateValue}. */
export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  /** `date` values (`YYYY-MM-DD`) are calendar dates and never shift. Default: guessed. */
  type?: "date" | "datetime";
  /** BCP 47 locale. Default `en`. */
  locale?: string;
  /** IANA time zone for datetimes. Default `UTC`. */
  timeZone?: string;
}

/**
 * Format a `date` or `datetime` value for people, in a locale and time zone. `YYYY-MM-DD`
 * strings (and any value with `type: "date"`) are calendar dates: they print the same day in
 * every time zone. Other values are instants shown in `timeZone`. Default style: `medium`
 * date, plus `short` time for datetimes. Invalid values are returned as text.
 */
export function formatDateValue(value: DateLike, options: FormatDateOptions = {}): string {
  const { type, locale = "en", timeZone = defaultTimeZone, ...format } = options;
  const isDate = type === "date" || (type === undefined && isDateString(value));
  let instant = new Date(value);
  if (isDate && typeof value === "string" && datePattern.test(value)) {
    instant = new Date(`${value}T00:00:00Z`);
  } else if (isDate && !Number.isNaN(instant.getTime())) {
    instant = new Date(`${dateInTimeZone(instant, timeZone)}T00:00:00Z`);
  }
  if (Number.isNaN(instant.getTime())) return String(value);
  let style: Intl.DateTimeFormatOptions = format;
  if (Object.keys(format).length === 0) {
    style = isDate ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
  }
  return new Intl.DateTimeFormat(locale, {
    ...style,
    timeZone: isDate ? "UTC" : timeZone,
  }).format(instant);
}

function isDateString(value: unknown): boolean {
  return typeof value === "string" && datePattern.test(value);
}

/**
 * The instant of an ISO string, or `null`. Strings with `Z` or an offset are instants. Strings
 * without one (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm[:ss]`) are wall-clock times in `timeZone`.
 * Other formats are rejected: `Date` parsing of them would depend on the server time zone.
 */
function instantOf(input: string | Date, timeZone: string): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (offsetDateTimePattern.test(input)) {
    const instant = new Date(input);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const zoned = zonedTimeToUtc(input, timeZone);
  return zoned === null ? null : new Date(zoned);
}

/**
 * Stored value of a `date` field. `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm` strings give the date as
 * written. A `Date` or an ISO datetime with an offset is an instant and gives its calendar
 * date in `timeZone`. `null` when the input is invalid.
 */
export function toDateValue(input: string | Date, timeZone: string): string | null {
  if (typeof input === "string" && !offsetDateTimePattern.test(input)) {
    return zonedTimeToUtc(input, defaultTimeZone) === null ? null : input.slice(0, 10);
  }
  const instant = instantOf(input, timeZone);
  return instant ? dateInTimeZone(instant, timeZone) : null;
}

/**
 * Stored value of a `datetime` field, an ISO 8601 UTC string. A `Date` or an ISO datetime
 * with an offset keeps its instant. `YYYY-MM-DD` (midnight) and `YYYY-MM-DDTHH:mm[:ss]` are
 * wall-clock times in `timeZone`. `null` when the input is invalid.
 */
export function toDatetimeValue(input: string | Date, timeZone: string): string | null {
  return instantOf(input, timeZone)?.toISOString() ?? null;
}
