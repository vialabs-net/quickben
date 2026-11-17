/** Stored shapes of the plugin's collections, as the plugin reads them. */
import type { Variant } from "./bench";
import type { JobState, RunPurpose, Split } from "./collections";
import type { ExtractionParams } from "./definition";
import type { ExtractionStatus, FieldValue } from "./extractor";
import type { RunMetrics, RunSummary, SampleAttributes, SampleResult } from "./metrics";
import type { PipelineAttempt } from "./pipeline";
import type { VersionEvaluation } from "./publish";
import type { SampleAnnotation } from "./studio";

interface System {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocTypeRecord extends System {
  readonly key: string;
  readonly version: number;
  readonly versionKey: string;
  readonly state: "draft" | "published";
  readonly draftKey: string | null;
  readonly label: string;
  readonly definition: unknown;
  readonly revision: string;
  readonly builtin: boolean | null;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
  readonly evaluation?: VersionEvaluation | null;
  readonly exampleSnapshot?:
    { fileRef: string; mime: string; values: Record<string, string> }[] | null;
}

export interface SampleRecord extends System {
  readonly typeKey: string;
  readonly fileRef: string;
  readonly fileName: string;
  readonly mime: string;
  readonly size: number | null;
  readonly expected: Record<string, string>;
  readonly params: ExtractionParams;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly sampleKey?: string | null;
  readonly sampleUid?: string | null;
  readonly fileHash?: string | null;
  readonly split?: Split | null;
  readonly splitVersion?: number | null;
  readonly group?: string | null;
  readonly attributes?: SampleAttributes | null;
  readonly annotations?: SampleAnnotation[] | null;
}

export interface TestRunRecord extends System {
  readonly typeKey: string;
  readonly typeVersion: number;
  readonly typeRevision: string;
  readonly compareGroup: string | null;
  readonly variant: Variant | null;
  readonly pipeline: unknown;
  readonly state: "running" | "done" | "failed";
  readonly results: SampleResult[];
  readonly summary: RunSummary | null;
  readonly error: string | null;
  readonly costUsd: number;
  readonly createdBy: string | null;
  readonly finishedAt: string | null;
  readonly definition?: unknown;
  readonly examplesRevision?: string | null;
  readonly splits?: Split[] | null;
  readonly splitVersion?: number | null;
  readonly heldOut?: boolean | null;
  readonly purpose?: RunPurpose | null;
  readonly rescoredFrom?: string | null;
  readonly sampleIds?: string[];
  readonly total?: number;
  readonly concurrency?: number;
  readonly maxCostUsd?: number | null;
  readonly retries?: number;
  readonly metrics?: RunMetrics | null;
}

export interface JobResult {
  readonly fields: Record<string, FieldValue>;
  readonly missing: string[];
}

export interface JobRecord extends System {
  readonly requestedType: string;
  readonly typeKey: string | null;
  readonly typeVersion: number | null;
  readonly fileRef: string;
  readonly fileName: string | null;
  readonly mime: string;
  readonly size: number | null;
  readonly params: ExtractionParams;
  readonly state: JobState;
  readonly status: ExtractionStatus | null;
  readonly result: JobResult | null;
  readonly attempts: PipelineAttempt[];
  readonly error: string | null;
  readonly costUsd: number;
  readonly durationMs: number | null;
  readonly runs: number;
  readonly queueVersion: number;
  readonly tenant: string | null;
  /** Present when the tenancy plugin scopes `doc-jobs`. */
  readonly organization?: string | null;
  readonly actorUserId: string | null;
  readonly actorEmail: string | null;
  readonly actorName: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface UsageRecord extends System {
  readonly tenant: string | null;
  readonly actorUserId: string | null;
  readonly job: string | null;
  readonly testRun: string | null;
  readonly typeKey: string;
  readonly typeVersion: number | null;
  readonly extractor: string;
  readonly connectionId: string;
  readonly connectionName: string | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number | null;
  readonly calls?: number | null;
  readonly pages: number;
  readonly costUsd: number;
  readonly latencyMs: number | null;
  readonly outcome: string | null;
}

export interface QuotaRecord extends System {
  readonly tenant: string;
  readonly monthlyUsd: number;
  readonly updatedBy: string | null;
}
