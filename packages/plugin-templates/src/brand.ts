/**
 * The look of generated documents: colors, font, logo, letterhead and footer. A render inlines
 * every asset as a `data:` URL, so the PDF renderer never fetches anything.
 */

/** Brand values as stored in the `brands` collection. */
export interface BrandFields {
  /** Name in the letterhead when there is no logo. */
  displayName: string | null;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  contact: string | null;
  /** Text at the foot of every page. A template's own page footer replaces it. */
  footer: string | null;
  /** `#rrggbb`: headings and the brand name. */
  primaryColor: string;
  /** `#rrggbb`: the letterhead rule. */
  accentColor: string;
  /** A font key: `sans`, `serif`, `mono`, a registered font or `custom`. */
  font: string;
  /** Uploaded woff2 files, used when `font` is `custom`. */
  customFont: CustomFont | null;
  /** The logo: a `data:` URL, or a reference that `assets.load` resolves. */
  logo: string | null;
}

/** An uploaded font: woff2 `data:` URLs (or asset references). */
export interface CustomFont {
  name: string;
  regular: string;
  bold?: string | null;
}

/** One `@font-face` of a render. */
export interface FontFaceSource {
  weight: 400 | 700;
  style: "normal" | "italic";
  /** A `data:` URL. */
  url: string;
}

/** A font a product registers in `templates({ fonts })`. */
export interface FontDefinition {
  key: string;
  label: string;
  /** Fallback family. */
  generic: "sans-serif" | "serif" | "monospace";
  /** The faces, as `data:` URLs. Called once per process and cached. */
  faces: () => Promise<readonly FontFaceSource[]>;
}

/** Everything a render needs from the brand. */
export interface BrandRender extends Omit<BrandFields, "logo" | "customFont"> {
  /** The logo as a `data:` URL. */
  logo: string | null;
  faces: readonly FontFaceSource[];
  /** CSS font stack after the brand face. */
  stack: string;
}

/** Values of a brand that was never saved. */
export const defaultBrand: BrandFields = {
  displayName: null,
  legalName: null,
  taxId: null,
  address: null,
  contact: null,
  footer: null,
  primaryColor: "#111827",
  accentColor: "#1d4ed8",
  font: "sans",
  customFont: null,
  logo: null,
};

/** Fonts that need no files. */
export const systemFonts = [
  {
    key: "sans",
    label: "Sans serif",
    stack: '"Helvetica Neue", Arial, "Liberation Sans", sans-serif',
  },
  { key: "serif", label: "Serif", stack: 'Georgia, "Times New Roman", "Liberation Serif", serif' },
  { key: "mono", label: "Monospace", stack: 'Menlo, Consolas, "Liberation Mono", monospace' },
] as const;

/** Font key of an uploaded font. */
export const CUSTOM_FONT = "custom";

/** Text limits of the brand fields. */
export const brandLimits = {
  displayName: 120,
  legalName: 160,
  taxId: 40,
  address: 200,
  contact: 200,
  footer: 300,
} as const;

/** Image types a logo may have. */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Largest logo. Server actions accept 1 MB bodies by default. */
export const LOGO_MAX_BYTES = 512 * 1024;
/** Largest font file. */
export const FONT_MAX_BYTES = 512 * 1024;

const hexPattern = /^#[\da-f]{6}$/i;

/** `#rrggbb`. */
export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && hexPattern.test(value);

/* Bytes and data URLs, without Node.js Buffer. */

const CHUNK = 0x8000;

/** Base64 of bytes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Bytes of base64. */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A `data:` URL. */
export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`;
}

const dataUrlPattern = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z\d+/]*={0,2})$/;

/** The type and bytes of a base64 `data:` URL, or `null`. */
export function parseDataUrl(url: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = dataUrlPattern.exec(url);
  if (!match?.[1] || match[2] === undefined) return null;
  try {
    return { mimeType: match[1], bytes: fromBase64(match[2]) };
  } catch {
    return null;
  }
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((byte, i) => bytes[offset + i] === byte);

/** The image type the bytes really are, or `null`. The declared type is not trusted. */
export function sniffImage(bytes: Uint8Array): (typeof LOGO_TYPES)[number] | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" … "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/** Whether the bytes are a woff2 font ("wOF2"). */
export const isWoff2 = (bytes: Uint8Array): boolean => startsWith(bytes, [0x77, 0x4f, 0x46, 0x32]);

/** Check a logo `data:` URL: a PNG, JPEG or WebP image, at most {@link LOGO_MAX_BYTES}. */
export function checkLogo(value: string): string | true {
  if (!value.startsWith("data:")) return true; // An asset reference.
  const parsed = parseDataUrl(value);
  if (!parsed) return "Invalid data URL";
  if (parsed.bytes.length > LOGO_MAX_BYTES) return "The logo is larger than 512 KB";
  const type = sniffImage(parsed.bytes);
  if (!type || type !== parsed.mimeType) return "The logo must be a PNG, JPEG or WebP image";
  return true;
}

/** Check a font `data:` URL: woff2, at most {@link FONT_MAX_BYTES}. */
export function checkFont(value: string): string | true {
  if (!value.startsWith("data:")) return true; // An asset reference.
  const parsed = parseDataUrl(value);
  if (!parsed) return "Invalid data URL";
  if (parsed.bytes.length > FONT_MAX_BYTES) return "A font file is larger than 512 KB";
  if (!isWoff2(parsed.bytes)) return "Fonts must be woff2 files";
  return true;
}

/** Collapse whitespace and trim; empty is `null`. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replaceAll(/\s+/g, " ").trim().slice(0, max);
  return text === "" ? null : text;
}
