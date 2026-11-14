import {
  BUST_VIEWBOX,
  HEAD_VIEWBOX,
  MARK_EYE_COLOR,
  MARK_EYES,
  MARK_HOOD,
  MARK_MANTLE,
  MARK_NIGHT,
  MARK_NIGHT_COLOR,
} from "./logo-geometry";

/**
 * Quickben mark: the High Mage. A hood with the night inside it and two half-moon eyes.
 * The hood takes the text colour, so it follows the theme. `bust` adds the mantle with its
 * twelve studs; leave it off below 48px.
 */
export function LogoMark({ size = 24, bust = false }: Readonly<{ size?: number; bust?: boolean }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={bust ? BUST_VIEWBOX : HEAD_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      {bust ? <path d={MARK_MANTLE} fill="currentColor" fillRule="evenodd" /> : null}
      <path d={MARK_HOOD} fill="currentColor" />
      <path d={MARK_NIGHT} fill={MARK_NIGHT_COLOR} />
      <path d={MARK_EYES} fill={MARK_EYE_COLOR} />
    </svg>
  );
}

/** Mark plus the "Quickben" wordmark, for the navbar. */
export function Logo() {
  return (
    <span className="qb-logo">
      <LogoMark size={30} />
      <span className="qb-wordmark">Quickben</span>
    </span>
  );
}
