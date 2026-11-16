import { createHash } from "node:crypto";

import { ConflictError } from "@quickben/core";

import { DOC_EVAL_CLAIMS } from "./collections";
import { SYSTEM } from "./system-context";

import type { SampleRecord } from "./records";
import type { Quickben } from "@quickben/core";

/** No lease takeover: an uncertain provider call must never be billed twice. */
export async function claim(qb: Quickben, key: string): Promise<string | null> {
  try {
    return (await qb.create(DOC_EVAL_CLAIMS, { key }, SYSTEM)).id;
  } catch (error) {
    if (error instanceof ConflictError) return null;
    throw error;
  }
}

/** Serialize split/publication/sample changes across processes. A crash requires manual recovery. */
export async function datasetWrite<T>(
  qb: Quickben,
  key: string,
  work: () => Promise<T>,
  attempts = 1,
): Promise<T> {
  let id = await claim(qb, `dataset:${key}`);
  for (let attempt = 1; id === null && attempt < attempts; attempt += 1) {
    await new Promise<void>((done) => setTimeout(done, 10));
    id = await claim(qb, `dataset:${key}`);
  }
  if (!id) throw new ConflictError("The dataset is being changed; retry when it finishes");
  try {
    return await work();
  } finally {
    await qb.delete(DOC_EVAL_CLAIMS, id, SYSTEM);
  }
}

/** Content identity; timestamps alone can collide within one millisecond. */
export function sampleRevision(sample: SampleRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        sample.fileRef,
        sample.expected,
        sample.params,
        sample.group ?? null,
        sample.attributes ?? {},
        sample.split ?? null,
        sample.splitVersion ?? null,
      ]),
    )
    .digest("hex");
}
