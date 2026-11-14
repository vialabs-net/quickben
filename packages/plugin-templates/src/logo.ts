/** The brand logo as a file: its storage, a data URL for renders and the migration helper. */
import { isFileRef } from "@quickben/core";

import { parseDataUrl, sniffImage, toDataUrl } from "./brand";
import { BRANDS, getTemplatesPlugin } from "./options";

import type { LOGO_TYPES } from "./brand";
import type { FileRef, Quickben, RequestContext, StorageAdapter } from "@quickben/core";

const system: RequestContext = { user: null, overrideAccess: true };

/** The storage of the `logoFile` field: the plugin's `storage`, else the config's. */
export function logoStorage(qb: Quickben): StorageAdapter | undefined {
  const field = qb.collections[BRANDS]?.fields.logoFile;
  return (field?.type === "file" ? field.storage : undefined) ?? qb.config.storage;
}

const fileUrlCache = new Map<string, Promise<string | null>>();
const CACHE_SIZE = 64;

/** A stored logo as a `data:` URL, cached by key and hash. `null` (not cached) when it is gone. */
export function logoDataUrl(qb: Quickben, ref: FileRef): Promise<string | null> {
  const storage = logoStorage(qb);
  if (!storage) return Promise.resolve(null);
  const cacheKey = `${ref.key}#${ref.sha256}`;
  let entry = fileUrlCache.get(cacheKey);
  if (!entry) {
    entry = storage.getBytes(ref.key).then((bytes) => {
      if (bytes) return toDataUrl(bytes, ref.mime);
      fileUrlCache.delete(cacheKey);
      return null;
    });
    entry.catch(() => fileUrlCache.delete(cacheKey));
    fileUrlCache.set(cacheKey, entry);
    while (fileUrlCache.size > CACHE_SIZE) {
      const oldest = fileUrlCache.keys().next().value;
      if (oldest === undefined) break;
      fileUrlCache.delete(oldest);
    }
  }
  return entry;
}

async function legacyBytes(qb: Quickben, value: string) {
  if (value.startsWith("data:")) return parseDataUrl(value)?.bytes ?? null;
  const file = await getTemplatesPlugin(qb).assets?.load(value);
  return file?.bytes ?? null;
}

const extensions: Record<(typeof LOGO_TYPES)[number], string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/** Result of {@link migrateBrandLogos}. */
export interface MigrateLogosResult {
  /** Brands whose logo moved to `logoFile`. */
  migrated: number;
  /** Brands whose old logo could not be read; they keep it. */
  skipped: number;
}

/** Move the old logo of one brand. `null` when there is nothing to move. */
async function migrateOne(
  qb: Quickben,
  brand: Record<string, unknown>,
  ctx: RequestContext,
): Promise<keyof MigrateLogosResult | null> {
  if (typeof brand.logo !== "string" || isFileRef(brand.logoFile)) return null;
  const bytes = await legacyBytes(qb, brand.logo);
  const type = bytes ? sniffImage(bytes) : null;
  if (!bytes || !type) return "skipped";
  // Reading the old logo may take a while: write only if the brand did not change meanwhile.
  return qb.transaction(async (tx) => {
    const id = String(brand.id);
    const fresh: Record<string, unknown> = await tx.findById(BRANDS, id, {}, ctx);
    if (fresh.logo !== brand.logo || isFileRef(fresh.logoFile)) return null;
    await tx.update(
      BRANDS,
      id,
      { logoFile: { name: `logo${extensions[type]}`, bytes }, logo: null },
      ctx,
    );
    return "migrated";
  });
}

/**
 * Move logos stored in the old `logo` field (`data:` URLs or asset references) to the
 * `logoFile` file field, in the configured storage, and clear `logo`. Brands that already
 * have a `logoFile` are left as they are. Run it once after you configure `storage`.
 */
export async function migrateBrandLogos(
  qb: Quickben,
  ctx: RequestContext = system,
): Promise<MigrateLogosResult> {
  const result: MigrateLogosResult = { migrated: 0, skipped: 0 };
  let cursor: string | null = null;
  do {
    const query: Record<string, unknown> = {
      where: { logo: { exists: true } },
      limit: 100,
      ...(cursor ? { cursor } : {}),
    };
    const page: { docs: unknown[]; hasNextPage: boolean; nextCursor: string | null } =
      await qb.find(BRANDS, query, ctx);
    for (const brand of page.docs as Record<string, unknown>[]) {
      const outcome = await migrateOne(qb, brand, ctx);
      if (outcome) result[outcome] += 1;
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return result;
}
