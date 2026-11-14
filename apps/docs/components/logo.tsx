import {
  BUST_VIEWBOX,
  HEAD_VIEWBOX,
  MARK_EYES,
  MARK_FACE,
  MARK_HOOD,
  MARK_MANTLE,
} from "./logo-geometry";

/**
 * Quickben mark: the High Mage. A hood, a saffron moon for a face and two half-lidded eyes.
 * The hood takes the text colour and the rest comes from the theme tokens. `bust` adds the
 * mantle with its twelve studs; leave it off below 48px.
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
      <path d={MARK_FACE} fill="var(--qb-accent, #f2a413)" />
      <path d={MARK_EYES} fill="var(--qb-accent-ink, #2a1b3d)" />
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
