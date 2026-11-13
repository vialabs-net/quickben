import { ConfigError } from "@quickben/core";

import { parseDocumentType } from "./definition";
import { createTextLayerExtractor } from "./extractors/text-layer";
import { createVisionLlmExtractor } from "./extractors/vision-llm";
import { memoryFileStore } from "./files";
import { inProcessRunner } from "./runner";

import type { DocumentType, DocumentTypeInput } from "./definition";
import type { Extractor } from "./extractor";
import type { Rasterize } from "./extractors/page-images";
import type { FileStore } from "./files";
import type { ListModels, ResolveModel } from "./models";
import type { Reading } from "./readings";
import type { JobRunner } from "./runner";
import type { ExtractionTemplate } from "./templates";
import type { TextReader } from "./text-readers";
import type { CollectionAccess, Quickben, QuickbenConfig, QuickbenUser } from "@quickben/core";

/** Options of `docReader()`. */
export interface DocReaderOptions {
  /** Where documents and samples are stored. Default: in memory (tests and demos only). */
  files?: FileStore;
  /** How jobs reach a worker. Default `inProcessRunner()`. */
  runner?: JobRunner;
  /**
   * Resolves a connection's model for `vision-llm` steps, e.g. from
   * `@quickben/plugin-connections`. Without it, `vision-llm` steps fail with `ERROR`.
   */
  resolveModel?: ResolveModel;
  /** Lists connections with vision models, for the admin's pickers. Optional. */
  listModels?: ListModels;
  /** Regex templates `text-layer` steps can name with `config.template`. */
  templates?: Readonly<Record<string, ExtractionTemplate>>;
  /** Reader functions `text-layer` steps can name with `config.reader`. */
  readers?: Readonly<Record<string, TextReader>>;
  /** More extractors, or replacements for the built-in ones (same `key`). */
  extractors?: readonly Extractor[];
  /** Types shipped with your code. Added as published versions when missing. */
  types?: readonly DocumentTypeInput[];
  /**
   * Platform staff: they manage types, samples, budgets and see every reading. Default: users
   * whose `roles` include `platform-admin`.
   */
  isStaff?: (user: QuickbenUser) => boolean;
  /** Replace access rules of `doc-jobs`. Default: staff see all, users see their own. */
  jobAccess?: CollectionAccess;
  /** Longest `wait` of `readDocument`, in ms. Default 30 000. */
  maxWaitMs?: number;
  /** Largest accepted file, in bytes. Default 20 MB. */
  maxFileBytes?: number;
  /** Page rendering for vision models. Default: unpdf with `@napi-rs/canvas`. */
  rasterize?: Rasterize;
  /** Deadline of one model call, in ms. Default 60 000. */
  modelTimeoutMs?: number;
  /** Called when a reading ends (done, failed). Errors are logged and ignored. */
  onReadingDone?: (reading: Reading, qb: Quickben) => void | Promise<void>;
  /** Structured log of failures that do not fail a reading. Default `console.warn`. */
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** Options after defaults, plus the instance the plugin started with. */
export interface DocReaderState {
  readonly files: FileStore;
  readonly runner: JobRunner;
  readonly extractors: Readonly<Record<string, Extractor>>;
  /** Keys of the registered templates and readers, for the admin's pickers. */
  readonly templateKeys: readonly string[];
  readonly readerKeys: readonly string[];
  readonly types: readonly DocumentType[];
  readonly isStaff: (user: QuickbenUser) => boolean;
  readonly listModels: ListModels | undefined;
  readonly hasModels: boolean;
  readonly maxWaitMs: number;
  readonly maxFileBytes: number;
  readonly onReadingDone: DocReaderOptions["onReadingDone"];
  readonly log: (event: string, data: Record<string, unknown>) => void;
  rootQb: Quickben | undefined;
}

export const defaultIsStaff = (user: QuickbenUser) =>
  user.roles?.includes("platform-admin") === true;

export function resolveOptions(options: DocReaderOptions): DocReaderState {
  const builtin: Extractor[] = [
    createTextLayerExtractor({
      ...(options.templates ? { templates: options.templates } : {}),
      ...(options.readers ? { readers: options.readers } : {}),
    }),
    createVisionLlmExtractor({
      ...(options.resolveModel ? { resolveModel: options.resolveModel } : {}),
      ...(options.rasterize ? { rasterize: options.rasterize } : {}),
      ...(options.modelTimeoutMs === undefined ? {} : { timeoutMs: options.modelTimeoutMs }),
    }),
  ];
  const extractors: Record<string, Extractor> = {};
  for (const extractor of [...builtin, ...(options.extractors ?? [])]) {
    extractors[extractor.key] = extractor;
  }
  const types = (options.types ?? []).map((input) => {
    try {
      return parseDocumentType({ ...input, state: "published" });
    } catch (error) {
      throw new ConfigError(`docReader: invalid type ${input.key}`, { cause: error });
    }
  });
  const keys = new Set<string>();
  for (const type of types) {
    const id = `${type.key}@${String(type.version)}`;
    if (keys.has(id)) throw new ConfigError(`docReader: type ${id} is listed twice`);
    keys.add(id);
  }
  return {
    files: options.files ?? memoryFileStore(),
    runner: options.runner ?? inProcessRunner(),
    extractors,
    templateKeys: Object.keys(options.templates ?? {}),
    readerKeys: Object.keys(options.readers ?? {}),
    types,
    isStaff: options.isStaff ?? defaultIsStaff,
    listModels: options.listModels,
    hasModels: options.resolveModel !== undefined,
    maxWaitMs: options.maxWaitMs ?? 30_000,
    maxFileBytes: options.maxFileBytes ?? 20 * 1024 * 1024,
    onReadingDone: options.onReadingDone,
    log:
      options.log ??
      ((event, data) => {
        console.warn(`[doc-reader] ${event}`, data);
      }),
    rootQb: undefined,
  };
}

const registered = new WeakMap<QuickbenConfig, DocReaderState>();

export function register(config: QuickbenConfig, state: DocReaderState): void {
  registered.set(config, state);
}

/** The doc reader's state of an instance. Throws `ConfigError` when the plugin is not installed. */
export function getDocReader(qb: Quickben): DocReaderState {
  const state = registered.get(qb.config);
  if (!state) throw new ConfigError("The doc reader plugin is not installed in this config");
  return state;
}
