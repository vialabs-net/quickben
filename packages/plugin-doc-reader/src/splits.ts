/**
 * Splits of a type's samples: `dev`, `validation`, `test` and `unseen`.
 *
 * A split is computed from a saved seed, so it can be reproduced. Samples whose `group` is in
 * `unseenGroups` all go to `unseen`; the rest are ordered by a hash of the seed and the sample
 * key within each stratum (the values of `stratifyBy`), and dealt out so every prefix keeps the
 * ratios. A new split is a new version and only `splitSamples` makes one. Samples added later
 * get a split from the hash of their key under the current version, so existing samples never
 * move.
 */
import { ValidationError } from "@quickben/core";
import { z } from "zod";

import { DOC_SAMPLES, DOC_SPLITS, SPLITS } from "./collections";
import { StudioError } from "./errors";
import { findAll, SYSTEM } from "./store";

import type { Split } from "./collections";
import type { SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

export interface SplitRatios {
  readonly dev: number;
  readonly validation: number;
  readonly test: number;
}

export const DEFAULT_RATIOS: SplitRatios = { dev: 0.6, validation: 0.2, test: 0.2 };

export interface SplitSettings {
  readonly seed: string;
  readonly ratios: SplitRatios;
  /** Sample properties to stratify by: `group`, or an attribute name. */
  readonly stratifyBy: readonly string[];
  /** Groups that go to `unseen`, all their samples. */
  readonly unseenGroups: readonly string[];
}

export interface SplitVersion extends SplitSettings {
  readonly id: string;
  readonly typeKey: string;
  readonly version: number;
  readonly counts: Readonly<Record<Split, number>>;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

/** What `assignSplits` needs of a sample. */
export interface SplitSubject {
  /** Stable key: the sample key of an import, else the file reference. */
  readonly key: string;
  readonly group: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

const ratioSchema = z.number().min(0).max(1);
export const splitInputSchema = z.object({
  seed: z.string().trim().min(1).max(200).optional(),
  ratios: z
    .object({ dev: ratioSchema, validation: ratioSchema, test: ratioSchema })
    .refine((r) => r.dev + r.validation + r.test > 0, "At least one ratio above 0")
    .optional(),
  stratifyBy: z.array(z.string().trim().min(1).max(64)).max(5).optional(),
  unseenGroups: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
  note: z.string().max(500).optional(),
  /** Required when the type has a split already: re-splitting moves samples. */
  resplit: z.boolean().optional(),
});
export type SplitInput = z.input<typeof splitInputSchema>;

/** 53-bit string hash (cyrb53), as a fraction in [0, 1). Same input, same number, everywhere. */
export function hashFraction(seed: string, key: string): number {
  const text = `${seed}\u0000${key}`;
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.codePointAt(i) ?? 0;
    h1 = Math.imul(h1 ^ ch, 2_654_435_761);
    h2 = Math.imul(h2 ^ ch, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  const value = 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0);
  return value / 2 ** 53;
}

const DEALT = ["dev", "validation", "test"] as const;

function normalized(ratios: SplitRatios): SplitRatios {
  const total = ratios.dev + ratios.validation + ratios.test;
  return {
    dev: ratios.dev / total,
    validation: ratios.validation / total,
    test: ratios.test / total,
  };
}

function stratumOf(subject: SplitSubject, stratifyBy: readonly string[]): string {
  return stratifyBy
    .map((name) => {
      if (name === "group") return JSON.stringify(subject.group);
      const value = Object.hasOwn(subject.attributes, name) ? subject.attributes[name] : null;
      return JSON.stringify(value ?? null);
    })
    .join("|");
}

/**
 * The split furthest behind its share of everything dealt so far. Carrying the counts across
 * strata keeps small strata from all landing in `dev`.
 */
function furthestBehind(
  ratios: SplitRatios,
  counts: Readonly<Record<(typeof DEALT)[number], number>>,
  dealt: number,
): (typeof DEALT)[number] {
  let pick: (typeof DEALT)[number] = "dev";
  let gap = Number.NEGATIVE_INFINITY;
  for (const split of DEALT) {
    if (ratios[split] === 0) continue;
    const behind = ratios[split] * dealt - counts[split];
    if (behind > gap + 1e-9) {
      gap = behind;
      pick = split;
    }
  }
  return pick;
}

/**
 * Splits of a set of samples. Deterministic: the same samples and settings give the same
 * result in any order.
 */
export function assignSplits(
  subjects: readonly SplitSubject[],
  settings: SplitSettings,
): Map<string, Split> {
  const out = new Map<string, Split>();
  const unseen = new Set(settings.unseenGroups);
  const strata = new Map<string, SplitSubject[]>();
  for (const subject of subjects) {
    if (subject.group !== null && unseen.has(subject.group)) {
      out.set(subject.key, "unseen");
      continue;
    }
    const stratum = stratumOf(subject, settings.stratifyBy);
    strata.set(stratum, [...(strata.get(stratum) ?? []), subject]);
  }
  const ratios = normalized(settings.ratios);
  const counts = { dev: 0, validation: 0, test: 0 };
  let dealt = 0;
  for (const stratum of [...strata.keys()].sort((a, b) => a.localeCompare(b))) {
    const members = (strata.get(stratum) ?? [])
      .map((subject) => ({ subject, order: hashFraction(settings.seed, subject.key) }))
      .sort((a, b) => a.order - b.order || a.subject.key.localeCompare(b.subject.key));
    for (const { subject } of members) {
      dealt += 1;
      const pick = furthestBehind(ratios, counts, dealt);
      counts[pick] += 1;
      out.set(subject.key, pick);
    }
  }
  return out;
}

/** The split of a sample added after a split was made. Never moves an existing sample. */
export function splitForNewSample(subject: SplitSubject, settings: SplitSettings): Split {
  if (subject.group !== null && settings.unseenGroups.includes(subject.group)) return "unseen";
  const ratios = normalized(settings.ratios);
  const x = hashFraction(settings.seed, subject.key);
  if (x < ratios.dev) return "dev";
  if (x < ratios.dev + ratios.validation) return "validation";
  return ratios.test > 0 ? "test" : "validation";
}

export const subjectOf = (record: SampleRecord): SplitSubject => ({
  key: record.sampleKey ?? record.fileRef,
  group: record.group ?? null,
  attributes: (record.attributes as Record<string, unknown> | null) ?? {},
});

interface SplitRecord {
  readonly id: string;
  readonly typeKey: string;
  readonly version: number;
  readonly seed: string;
  readonly ratios: SplitRatios;
  readonly stratifyBy: string[];
  readonly unseenGroups: string[];
  readonly counts: Record<Split, number>;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

const toSplitVersion = (record: SplitRecord): SplitVersion => ({
  id: record.id,
  typeKey: record.typeKey,
  version: record.version,
  seed: record.seed,
  ratios: record.ratios,
  stratifyBy: record.stratifyBy,
  unseenGroups: record.unseenGroups,
  counts: record.counts,
  note: record.note,
  createdBy: record.createdBy,
  createdAt: record.createdAt,
});

/** Split versions of a type, newest first. */
export async function listSplits(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
): Promise<SplitVersion[]> {
  const records = await findAll<SplitRecord>(qb, DOC_SPLITS, { typeKey: { eq: typeKey } }, ctx, {
    sort: "-version",
  });
  return records.map((record) => toSplitVersion(record));
}

/** The split in force for a type, or `null` before the first `splitSamples`. */
export async function currentSplit(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
): Promise<SplitVersion | null> {
  const page = await qb.find(
    DOC_SPLITS,
    { where: { typeKey: { eq: typeKey } }, sort: "-version", limit: 1 },
    ctx,
  );
  const record = page.docs[0] as unknown as SplitRecord | undefined;
  return record ? toSplitVersion(record) : null;
}

const emptyCounts = (): Record<Split, number> => ({ dev: 0, validation: 0, test: 0, unseen: 0 });

function randomSeed(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Split a type's samples: a new split version. The first split needs no flag; later ones need
 * `resplit: true`, since they move samples between splits and earlier runs stop being
 * comparable.
 */
export async function splitSamples(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  input: SplitInput = {},
): Promise<SplitVersion> {
  const parsed = splitInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  const options = parsed.data;
  const current = await currentSplit(qb, ctx, typeKey);
  if (current && options.resplit !== true) {
    throw new StudioError(
      "split-exists",
      `${typeKey} is split already (v${String(current.version)}); pass resplit to split again`,
    );
  }
  const settings: SplitSettings = {
    seed: options.seed ?? randomSeed(),
    ratios: options.ratios ?? DEFAULT_RATIOS,
    stratifyBy: options.stratifyBy ?? ["group"],
    unseenGroups: options.unseenGroups ?? [],
  };
  const samples = await findAll<SampleRecord>(qb, DOC_SAMPLES, { typeKey: { eq: typeKey } }, ctx);
  if (samples.length === 0) throw new StudioError("no-samples", "Add samples before splitting");
  const version = (current?.version ?? 0) + 1;
  const splits = assignSplits(
    samples.map((record) => subjectOf(record)),
    settings,
  );
  const counts = emptyCounts();
  for (const record of samples) {
    const split = splits.get(subjectOf(record).key) ?? "dev";
    counts[split] += 1;
    await qb.update(DOC_SAMPLES, record.id, { split, splitVersion: version }, ctx);
  }
  const record = await qb.create(
    DOC_SPLITS,
    {
      typeKey,
      version,
      versionKey: `${typeKey}@${String(version)}`,
      ...settings,
      counts,
      note: options.note?.trim() ? options.note.trim() : null,
      createdBy: ctx.user?.email ?? ctx.user?.id ?? null,
    },
    ctx,
  );
  return toSplitVersion(record as unknown as SplitRecord);
}

/** Split fields of a new sample: none before the first split. */
export async function splitFieldsFor(
  qb: Quickben,
  typeKey: string,
  subject: SplitSubject,
): Promise<{ split: Split | null; splitVersion: number | null }> {
  const current = await currentSplit(qb, SYSTEM, typeKey);
  if (!current) return { split: null, splitVersion: null };
  return { split: splitForNewSample(subject, current), splitVersion: current.version };
}

export const isSplit = (value: unknown): value is Split =>
  typeof value === "string" && (SPLITS as readonly string[]).includes(value);
