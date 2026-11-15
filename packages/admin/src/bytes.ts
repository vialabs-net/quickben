import type { AdminI18n } from "./i18n/translator";

const KB = 1024;
const MB = KB * 1024;

/** A file size for people: `512 kB`, `1.5 MB`. */
export function formatBytes(i18n: Pick<AdminI18n, "number">, bytes: number): string {
  if (bytes >= MB) {
    return i18n.number(bytes / MB, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  }
  return i18n.number(Math.max(1, Math.ceil(bytes / KB)), { style: "unit", unit: "kilobyte" });
}
