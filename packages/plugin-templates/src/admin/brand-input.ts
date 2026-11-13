import { CUSTOM_FONT, sniffImage, toDataUrl } from "../brand";
import { getTemplatesPlugin } from "../options";

import type { Quickben } from "@quickben/core";

const textFields = ["displayName", "legalName", "taxId", "address", "contact", "footer"] as const;

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function upload(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return typeof value === "object" && value !== null && value.size > 0 ? value : null;
}

/** Store a file: through the asset store when there is one, else as a `data:` URL. */
async function store(qb: Quickben, file: File, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const assets = getTemplatesPlugin(qb).assets;
  return assets ? assets.save({ bytes, mimeType, name: file.name }) : toDataUrl(bytes, mimeType);
}

/**
 * The brand changes of the brand form. Files become `data:` URLs (or asset references); the
 * `brands` collection validates their type and size.
 */
export async function brandInput(
  qb: Quickben,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  for (const field of textFields) data[field] = text(formData, field);
  for (const field of ["primaryColor", "accentColor"] as const) {
    const value = text(formData, field);
    if (value !== null) data[field] = value.toLowerCase();
  }
  const font = text(formData, "font");
  if (font !== null) data.font = font;

  const logo = upload(formData, "logo");
  if (formData.get("removeLogo") === "on") data.logo = null;
  else if (logo) {
    const bytes = new Uint8Array(await logo.slice(0, 16).arrayBuffer());
    data.logo = await store(
      qb,
      logo,
      sniffImage(bytes) ?? (logo.type || "application/octet-stream"),
    );
  }

  const regular = upload(formData, "fontRegular");
  if (formData.get("removeFont") === "on") {
    data.customFont = null;
    if (data.font === CUSTOM_FONT) data.font = "sans";
  } else if (regular) {
    const bold = upload(formData, "fontBold");
    data.customFont = {
      name: text(formData, "fontName") ?? regular.name.replace(/\.woff2$/i, "").slice(0, 80),
      regular: await store(qb, regular, "font/woff2"),
      bold: bold ? await store(qb, bold, "font/woff2") : null,
    };
    data.font = CUSTOM_FONT;
  }
  return data;
}
