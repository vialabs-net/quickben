/** Small helpers over the local API, shared by the plugin's modules. */
import { ConflictError } from "@quickben/core";

import { DOC_TYPES } from "./collections";
import { parseDocumentType } from "./definition";

import type { DocumentType } from "./definition";
import type { DocTypeRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

/** Trusted server code: the plugin's own writes and background work. */
export const SYSTEM: RequestContext = { user: null, overrideAccess: true };

/** Every document that matches, page by page. */
export async function findAll<T>(
  qb: Quickben,
  slug: string,
  where: Record<string, unknown>,
  ctx: RequestContext,
  options: { sort?: string | string[]; select?: string[] } = {},
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await qb.find(
      slug,
      {
        where,
        limit: 500,
        ...(options.sort ? { sort: options.sort } : {}),
        ...(options.select ? { select: options.select } : {}),
        ...(cursor ? { cursor } : {}),
      } as never,
      ctx,
    );
    out.push(...(page.docs as unknown as T[]));
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
}

/** The definition stored in a version, with the version's own key, number and state. */
export function toDefinition(record: DocTypeRecord): DocumentType {
  return parseDocumentType({
    ...(record.definition as object),
    key: record.key,
    version: record.version,
    state: record.state,
  });
}

export const versionKey = (key: string, version: number) => `${key}@${String(version)}`;

/** A published version: the given one, or the newest. */
export async function findPublished(
  qb: Quickben,
  key: string,
  version?: number,
): Promise<DocumentType | undefined> {
  const page = await qb.find(
    DOC_TYPES,
    {
      where: {
        key: { eq: key },
        state: { eq: "published" },
        ...(version === undefined ? {} : { version: { eq: version } }),
      },
      sort: "-version",
      limit: 1,
    },
    SYSTEM,
  );
  const record = page.docs[0] as unknown as DocTypeRecord | undefined;
  return record ? toDefinition(record) : undefined;
}

/** The newest published version of each type, for `type: "auto"`. */
export async function newestPublished(qb: Quickben): Promise<DocumentType[]> {
  const records = await findAll<DocTypeRecord>(
    qb,
    DOC_TYPES,
    { state: { eq: "published" } },
    SYSTEM,
    { sort: ["key", "-version"] },
  );
  const newest = new Map<string, DocTypeRecord>();
  for (const record of records) if (!newest.has(record.key)) newest.set(record.key, record);
  return [...newest.values()].map((record) => toDefinition(record));
}

export function newRevision(): string {
  return globalThis.crypto.randomUUID();
}

/** Add the types shipped with the code that are not stored yet, as published versions. */
export async function seedTypes(qb: Quickben, types: readonly DocumentType[]): Promise<void> {
  for (const type of types) {
    const key = versionKey(type.key, type.version);
    const existing = await qb.find(
      DOC_TYPES,
      { where: { versionKey: { eq: key } }, limit: 1 },
      SYSTEM,
    );
    if (existing.docs.length > 0) continue;
    try {
      await qb.create(
        DOC_TYPES,
        {
          key: type.key,
          version: type.version,
          versionKey: key,
          state: "published",
          label: type.label,
          definition: type,
          revision: newRevision(),
          builtin: true,
          publishedAt: new Date().toISOString(),
        },
        SYSTEM,
      );
    } catch (error) {
      // Another process seeded it first.
      if (!(error instanceof ConflictError)) throw error;
    }
  }
}
