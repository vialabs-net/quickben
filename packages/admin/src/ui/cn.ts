/** Join class names, skipping empty values. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Visible focus ring shared by every interactive element. */
export const focusRing =
  "qb:focus-visible:outline-2 qb:focus-visible:outline-offset-2 qb:focus-visible:outline-blue-600";
