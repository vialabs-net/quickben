/** Stored shapes of the plugin's collections, as the plugin reads them. */
import type { JobState } from "./collections";
import type { ExtractionParams } from "./definition";
import type { ExtractionStatus, FieldValue } from "./extractor";
import type { PipelineAttempt } from "./pipeline";
import type { RunSummary, SampleResult, Variant } from "./studio";

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
