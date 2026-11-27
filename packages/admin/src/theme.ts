import type { CSSProperties } from "react";

/**
 * Theme of the admin: values for the `--qb-*` custom properties, set on `.qb-root`. Every key
 * is optional; a missing key keeps the default from `styles.css`. Values are CSS values, so
 * `light-dark(#fff, #18181b)` and `var(--brand-600)` work too.
 */
export interface AdminTheme {
  /** `--qb-font-sans`. Load the font yourself, e.g. with `next/font`. */
  fontSans?: string;
  /** `--qb-font-mono`. */
  fontMono?: string;
  /** `--qb-surface`: cards, inputs, sidebar. */
  surface?: string;
  /** `--qb-surface-muted`: page background, table headers. */
  surfaceMuted?: string;
  /** `--qb-text`: body text. */
  text?: string;
  /** `--qb-text-muted`: secondary text. */
  textMuted?: string;
  /** `--qb-heading-text`: page and card titles, the sidebar title. Default `text`. */
  headingText?: string;
  /** `--qb-border`: borders and dividers. */
  border?: string;
  /** `--qb-border-strong`: input and secondary button borders. Default mixed from `border`. */
  borderStrong?: string;
  /** `--qb-accent`: primary buttons, toasts. */
  accent?: string;
  /** `--qb-accent-hover`: primary buttons on hover. Default mixed from `accent`. */
  accentHover?: string;
  /** `--qb-accent-text`: text on `accent`. */
  accentText?: string;
  /** `--qb-selected`: background of the current sidebar link and the active option. */
  selected?: string;
  /** `--qb-danger`: errors, delete buttons. */
  danger?: string;
  /** `--qb-danger-strong`: error text on soft backgrounds. Default mixed from `danger`. */
  dangerStrong?: string;
  /** `--qb-danger-text`: text on `danger`. */
  dangerText?: string;
  /** `--qb-success`. */
  success?: string;
  /** `--qb-success-strong`: success text on soft backgrounds. Default `success`. */
  successStrong?: string;
  /** `--qb-warning`. */
  warning?: string;
  /** `--qb-info`. */
  info?: string;
  /** `--qb-focus-ring`. */
  focusRing?: string;
  /** `--qb-radius`: controls. */
  radius?: string;
  /** `--qb-button-radius`. Default `radius`. `9999px` gives pill buttons. */
  buttonRadius?: string;
  /** `--qb-card-radius`. */
  cardRadius?: string;
  /** `--qb-card-padding`. */
  cardPadding?: string;
  /** `--qb-card-shadow`: a `box-shadow` value. */
  cardShadow?: string;
  /** `--qb-title-size`: page titles. */
  titleSize?: string;
  /** `--qb-title-weight`. */
  titleWeight?: string;
  /** `--qb-heading-size`: card and section titles. */
  headingSize?: string;
  /** `--qb-heading-weight`. */
  headingWeight?: string;
  /** `--qb-table-row-height`. */
  tableRowHeight?: string;
  /** `--qb-select-chevron`: color of the chevron of selects. Default text at 60%. */
  selectChevron?: string;
  /** `--qb-select-chevron-inset`: space between the chevron and the end edge. `0.75rem`. */
  selectChevronInset?: string;
  /** `--qb-select-chevron-space`: end padding of selects, kept free for the chevron. `2rem`. */
  selectChevronSpace?: string;
}

/** CSS custom property of each {@link AdminTheme} key. */
const themeProperties: Readonly<Record<keyof AdminTheme, `--qb-${string}`>> = {
  fontSans: "--qb-font-sans",
  fontMono: "--qb-font-mono",
  surface: "--qb-surface",
  surfaceMuted: "--qb-surface-muted",
  text: "--qb-text",
  textMuted: "--qb-text-muted",
  headingText: "--qb-heading-text",
  border: "--qb-border",
  borderStrong: "--qb-border-strong",
  accent: "--qb-accent",
  accentHover: "--qb-accent-hover",
  accentText: "--qb-accent-text",
  selected: "--qb-selected",
  danger: "--qb-danger",
  dangerStrong: "--qb-danger-strong",
  dangerText: "--qb-danger-text",
  success: "--qb-success",
  successStrong: "--qb-success-strong",
  warning: "--qb-warning",
  info: "--qb-info",
  focusRing: "--qb-focus-ring",
  radius: "--qb-radius",
  buttonRadius: "--qb-button-radius",
  cardRadius: "--qb-card-radius",
  cardPadding: "--qb-card-padding",
  cardShadow: "--qb-card-shadow",
  titleSize: "--qb-title-size",
  titleWeight: "--qb-title-weight",
  headingSize: "--qb-heading-size",
  headingWeight: "--qb-heading-weight",
  tableRowHeight: "--qb-table-row-height",
  selectChevron: "--qb-select-chevron",
  selectChevronInset: "--qb-select-chevron-inset",
  selectChevronSpace: "--qb-select-chevron-space",
};

/**
 * The `style` of `.qb-root` for a theme: one custom property per set key. `undefined` when
 * nothing is set, so the default look has no inline style.
 */
export function themeStyle(theme: AdminTheme | undefined): CSSProperties | undefined {
  if (theme === undefined) return undefined;
  const style: Record<string, string> = {};
  for (const [key, property] of Object.entries(themeProperties)) {
    const value = theme[key as keyof AdminTheme];
    if (value !== undefined && value !== "") style[property] = value;
  }
  return Object.keys(style).length === 0 ? undefined : style;
}
