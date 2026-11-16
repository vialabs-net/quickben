/**
 * Few-shot examples of a type. They are samples of the `dev` split: an example from
 * `validation`, `test` or `unseen` would leak the answers the type is judged on.
 */
import { ValidationError } from "@quickben/core";

import { DOC_SAMPLES } from "./collections";
import { isEmptyValue } from "./metrics";
import { getDocReader } from "./options";
import { findAll, SYSTEM } from "./store";

import type { DocumentType, FewShotExample } from "./definition";
import type { ExtractorExample } from "./extractor";
import type { SampleRecord } from "./records";
import type { Quickben, RequestContext } from "@quickben/core";

async function exampleRecords(
  qb: Quickben,
  ctx: RequestContext,
  examples: readonly FewShotExample[],
): Promise<SampleRecord[]> {
  if (examples.length === 0) return [];
  return findAll<SampleRecord>(
    qb,
    DOC_SAMPLES,
    { id: { in: examples.map((example) => example.sampleId) } },
    ctx,
  );
}

/**
 * Refuse examples that are not `dev` samples of the type. Called when a draft is saved and
 * when it is published (a re-split may have moved a sample).
 */
export async function checkExamples(
  qb: Quickben,
  ctx: RequestContext,
  typeKey: string,
  examples: readonly FewShotExample[],
): Promise<void> {
  const records = new Map(
    (await exampleRecords(qb, ctx, examples)).map((record) => [record.id, record]),
  );
  const issues = examples.flatMap((example, index) => {
    const record = records.get(example.sampleId);
    if (record?.typeKey !== typeKey) {
      return [{ path: `examples.${String(index)}`, message: "Not a sample of this type" }];
    }
    if (record.split !== "dev") {
      return [
        { path: `examples.${String(index)}`, message: "Few-shot examples must be dev samples" },
      ];
    }
    return [];
  });
  if (issues.length > 0) throw new ValidationError(issues);
}

/** The type's examples with their files, for extractors. Missing ones are left out. */
export async function loadExamples(qb: Quickben, type: DocumentType): Promise<ExtractorExample[]> {
  if (type.examples.length === 0) return [];
  const state = getDocReader(qb);
  const records = new Map(
    (await exampleRecords(qb, SYSTEM, type.examples)).map((record) => [record.id, record]),
  );
  const out: ExtractorExample[] = [];
  for (const example of type.examples) {
    const record = records.get(example.sampleId);
    if (record?.split !== "dev") continue;
    const bytes = await state.files.getBytes(record.fileRef).catch(() => undefined);
    if (!bytes) continue;
    const values = Object.fromEntries(
      Object.entries(record.expected).filter(
        ([, value]) => !isEmptyValue(value, type.evaluation.emptyValues),
      ),
    );
    out.push({ bytes, mime: record.mime, values });
  }
  return out;
}
