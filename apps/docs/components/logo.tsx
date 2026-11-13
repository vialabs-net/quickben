/** Quickben mark: a record card with a "q". */
export function LogoMark({ size = 24 }: Readonly<{ size?: number }>) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--qb-accent, #2747c9)" />
      <circle cx="14.5" cy="14.5" r="6.5" fill="none" stroke="#fff" strokeWidth="3.2" />
      <path d="M19.2 19.2 L24.5 24.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus the "Quickben" wordmark, for the navbar. */
export function Logo() {
  return (
    <span className="qb-logo">
      <LogoMark />
      <span className="qb-wordmark">Quickben</span>
    </span>
  );
}
