/**
 * The interface every extractor implements (text layer, vision LLM, your own). An extractor
 * never throws for a document it cannot read: it returns a status. A throw is a bug or an
 * outage, and the pipeline records it as `ERROR`.
 */
import type { DocumentType, ExtractionParams } from "./definition";
import type { Quickben } from "@quickben/core";

export const EXTRACTION_STATUSES = ["OK", "INCOMPLETE", "NO_MATCH", "NO_TEXT", "ERROR"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export interface ExtractorInput {
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** 1-based pages to read, from the document type. */
  readonly pages: readonly number[];
}

/** Who asked for a reading. */
export interface ExtractorUser {
  readonly id: string;
  readonly email?: string;
}

export interface ExtractorContext {
  /** Tenant the read is billed to, or `null`. Extractors only pass it on. */
  readonly tenant: string | null;
  /**
   * The Quickben instance the plugin runs in, e.g. to resolve a connection. Set for every
   * reading and test run; absent only when you call `runPipeline` without `qb`.
   */
  readonly qb?: Quickben;
  /** Who asked for the reading. `null` for test runs and system work. */
  readonly user?: ExtractorUser | null;
  readonly jobId?: string;
  /** The pipeline step's `config`. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  /** The type's few-shot examples, loaded. LLM extractors may show them to the model. */
  readonly examples?: readonly ExtractorExample[];
}

/** A few-shot example: a document and the values it reads to. */
export interface ExtractorExample {
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** Expected values by field key. Fields without a value are absent. */
  readonly values: Readonly<Record<string, string>>;
}

/** Where a value is on its page: corners as fractions 0..1, origin top left. */
export interface FieldBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface FieldEvidence {
  /** 1-based. */
  readonly page: number;
  readonly text: string;
  readonly box?: FieldBox;
}

export interface FieldValue {
  readonly value: string;
  /** 0..1. */
  readonly confidence: number;
  readonly evidence?: FieldEvidence;
}

export interface ExtractionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens served from the provider's cache. Part of `inputTokens`. */
  readonly cachedInputTokens?: number;
  readonly pages: number;
  /** Computed from the connection's prices, never from a library table. */
  readonly costUsd: number;
  readonly model: string;
  readonly connectionId: string;
  readonly connectionName?: string;
  /** Model calls made, when more than one counts: field groups and repairs. */
  readonly calls?: number;
}

export interface ExtractionResult {
  readonly status: ExtractionStatus;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly usage?: ExtractionUsage;
  readonly problems?: Readonly<Record<string, unknown>>;
  /** Extra calls made to repair an incomplete or invalid answer. Their cost is in `usage`. */
  readonly repairs?: number;
}

export interface Extractor {
  readonly key: string;
  /** Paid extractors are skipped when the tenant or the platform is over budget. */
  readonly paid: boolean;
  extract(
    input: ExtractorInput,
    type: DocumentType,
    params: ExtractionParams,
    ctx: ExtractorContext,
  ): Promise<ExtractionResult>;
}
