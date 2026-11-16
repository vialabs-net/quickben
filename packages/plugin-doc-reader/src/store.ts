/** Small helpers over the local API, shared by the plugin's modules. */
import { ConflictError } from "@quickben/core";

import { DOC_TYPES } from "./collections";
import { parseDocumentType } from "./definition";
import { datasetWrite } from "./eval-state";
import { SYSTEM } from "./system-context";

import type { DocumentType } from "./definition";
import type { DocTypeRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export { SYSTEM } from "./system-context";

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
export function toDefinition(
  record: Pick<DocTypeRecord, "definition" | "key" | "version" | "state">,
): DocumentType {
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

/** JSON with sorted keys, so two equal definitions give the same text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const body = entries.map(([key, inner]) => JSON.stringify(key) + ":" + stableJson(inner));
    return "{" + body.join(",") + "}";
  }
  return JSON.stringify(value);
}

/** What a definition says, without the version's own number and state. */
export function definitionFingerprint(type: DocumentType): string {
  return stableJson({ ...type, version: undefined, state: undefined });
}

function storedFingerprint(record: DocTypeRecord): string | null {
  try {
    return definitionFingerprint(toDefinition(record));
  } catch {
    // A stored definition the current schema rejects matches nothing.
    return null;
  }
}

/** What {@link seedTypes} did. Keys are `key@version`. */
export interface SeedReport {
  /** Versions added as published. */
  readonly added: string[];
  /** Drafts created or updated with a change made in the code. */
  readonly drafted: string[];
  /** Types changed in the code that already have a draft made in the admin: left alone. */
  readonly skipped: string[];
}

type SeedLog = (event: string, data: Record<string, unknown>) => void;

/**
 * Store the types shipped with the code. A version not stored yet is added as published. A
 * version stored with another definition is never changed: when no stored version has the
 * code's definition, it becomes a new draft (marked `builtin`), or updates the draft an
 * earlier start made. A draft made in the admin is left alone. Both cases are logged as
 * `type-changed-in-code`.
 */
export async function seedTypes(
  qb: Quickben,
  types: readonly DocumentType[],
  log: SeedLog = () => undefined,
): Promise<SeedReport> {
  const report: SeedReport = { added: [], drafted: [], skipped: [] };
  for (const type of types) {
    const key = versionKey(type.key, type.version);
    const records = await findAll<DocTypeRecord>(qb, DOC_TYPES, { key: { eq: type.key } }, SYSTEM, {
      sort: "-version",
    });
    if (records.some((record) => record.version === type.version)) {
      await proposeDraft(qb, type, records, report, log);
      continue;
    }
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
      report.added.push(key);
    } catch (error) {
      // Another process seeded it first.
      if (!(error instanceof ConflictError)) throw error;
    }
  }
  return report;
}

async function proposeDraft(
  qb: Quickben,
  type: DocumentType,
  records: readonly DocTypeRecord[],
  report: SeedReport,
  log: SeedLog,
): Promise<void> {
  const code = definitionFingerprint(type);
  if (records.some((record) => storedFingerprint(record) === code)) return;
  const draft = records.find((record) => record.state === "draft");
  const newest = records[0];
  if (!newest) return;
  if (draft && draft.builtin !== true) {
    report.skipped.push(versionKey(type.key, type.version));
    log("type-changed-in-code", {
      type: type.key,
      codeVersion: type.version,
      draft: draft.version,
      applied: false,
      reason:
        "the type has a draft made in the admin; publish or delete it to get the code's change",
    });
    return;
  }
  const version = draft?.version ?? newest.version + 1;
  const definition = { ...type, version, state: "draft" as const };
  try {
    if (draft) {
      await datasetWrite(qb, type.key, () =>
        qb.transaction(async (tx) => {
          const current = (await tx.findById(
            DOC_TYPES,
            draft.id,
            {},
            SYSTEM,
          )) as unknown as DocTypeRecord;
          if (
            current.state !== "draft" ||
            current.builtin !== true ||
            current.revision !== draft.revision
          ) {
            throw new ConflictError("The code draft changed during startup; leave it alone");
          }
          await tx.update(
            DOC_TYPES,
            draft.id,
            { label: type.label, definition, revision: newRevision(), updatedBy: "code" },
            SYSTEM,
          );
        }),
      );
    } else {
      await qb.create(
        DOC_TYPES,
        {
          key: type.key,
          version,
          versionKey: versionKey(type.key, version),
          state: "draft",
          draftKey: type.key,
          label: type.label,
          definition,
          revision: newRevision(),
          builtin: true,
          createdBy: "code",
          updatedBy: "code",
        },
        SYSTEM,
      );
    }
  } catch (error) {
    // Another process proposed it first.
    if (error instanceof ConflictError) return;
    throw error;
  }
  report.drafted.push(versionKey(type.key, version));
  log("type-changed-in-code", {
    type: type.key,
    codeVersion: type.version,
    draft: version,
    applied: true,
    reason: `the code changed ${versionKey(type.key, type.version)}; review and publish draft v${String(version)}`,
  });
}
