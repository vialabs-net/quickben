import type { ProviderLogo } from "./provider";

/**
 * Logos of the built-in providers, as `data:` URIs so the package needs no static files.
 * Sources and licenses: see LOGOS.md in this package.
 */

/** Gray ink for light and dark backgrounds. */
const LIGHT_INK = "#4B5563";
const DARK_INK = "#9CA3AF";

function svgUri(body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>`,
  )}`;
}

function filled(path: string, keyline?: ProviderLogo["keyline"]): ProviderLogo {
  const mark = (ink: string) => svgUri(`<path fill="${ink}" d="${path}"/>`);
  return { light: mark(LIGHT_INK), dark: mark(DARK_INK), ...(keyline ? { keyline } : {}) };
}

function stroked(paths: readonly string[]): ProviderLogo {
  const mark = (ink: string) =>
    svgUri(
      `<g fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths
        .map((d) => `<path d="${d}"/>`)
        .join("")}</g>`,
    );
  return { light: mark(LIGHT_INK), dark: mark(DARK_INK) };
}

/** Simple Icons 16.37.0, `anthropic` (CC0 1.0). */
export const anthropicLogo = filled(
  "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z",
);

/** Simple Icons 16.37.0, `googlegemini` (CC0 1.0). A four-point star: drawn larger. */
export const geminiLogo = filled(
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
  "circle",
);

/** Simple Icons 16.37.0, `googlecloud` (CC0 1.0). */
export const googleCloudLogo = filled(
  "M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z",
);

/** A neutral API glyph (code brackets), for OpenAI-compatible gateways. Drawn for Quickben. */
export const apiLogo = stroked(["M8 5 3 12l5 7", "m16 5 5 7-5 7", "m14 4-4 16"]);

/** A neutral HTTP glyph (a globe), for generic HTTP APIs. Drawn for Quickben. */
export const httpLogo = stroked([
  "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  "M3 12h18",
  "M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z",
]);
