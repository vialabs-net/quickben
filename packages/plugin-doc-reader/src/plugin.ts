import { definePlugin } from "@quickben/core";

import { processTestRunItem, TEST_RUN_JOB } from "./bench";
import {
  docJobsCollection,
  docQuotasCollection,
  docSamplesCollection,
  docSplitsCollection,
  docTestResultsCollection,
  docTestRunsCollection,
  docTypesCollection,
  docUsageCollection,
} from "./collections";
import { register, resolveOptions } from "./options";
import { failInterruptedJobs, processJob, requeueJobs } from "./readings";
import { seedTypes } from "./store";

import type {
  DocJobsCollection,
  DocQuotasCollection,
  DocSamplesCollection,
  DocSplitsCollection,
  DocTestResultsCollection,
  DocTestRunsCollection,
  DocTypesCollection,
  DocUsageCollection,
} from "./collections";
import type { DocReaderOptions } from "./options";
import type { Plugin } from "@quickben/core";

/** The plugin returned by {@link docReader}. */
export type DocReaderPlugin = Plugin<
  | DocTypesCollection
  | DocSamplesCollection
  | DocTestRunsCollection
  | DocJobsCollection
  | DocUsageCollection
  | DocQuotasCollection
  | DocSplitsCollection
  | DocTestResultsCollection
>;

/**
 * Document reading. Adds `doc-types`, `doc-samples`, `doc-test-runs`, `doc-jobs`, `doc-usage`,
 * `doc-quotas`, `doc-splits` and `doc-test-results`. Read documents with
 * `readDocument(qb, input, ctx)`.
 *
 * With `@quickben/plugin-tenancy`, list `doc-jobs` in its `scope` (and list `tenancy()` after
 * this plugin) so readings belong to an organization and budgets apply per organization.
 */
export function docReader(options: DocReaderOptions = {}): DocReaderPlugin {
  const state = resolveOptions(options);
  return definePlugin({
    name: "doc-reader",
    collections: [
      docTypesCollection(state.isStaff),
      docSamplesCollection(state.isStaff),
      docTestRunsCollection(state.isStaff),
      docJobsCollection(state.isStaff, options.jobAccess),
      docUsageCollection(state.isStaff),
      docQuotasCollection(state.isStaff),
      docSplitsCollection(state.isStaff),
      docTestResultsCollection(state.isStaff),
    ],
    onInit: async (qb) => {
      state.rootQb = qb;
      if (!state.ownFiles && qb.config.storage) state.files = qb.config.storage;
      register(qb.config, state);
      await seedTypes(qb, state.types);
      state.runner.start((jobId, run) =>
        jobId.startsWith(TEST_RUN_JOB)
          ? processTestRunItem(qb, jobId, run)
          : processJob(qb, jobId, run),
      );
      if (state.runner.inProcess) {
        await failInterruptedJobs(qb);
        await requeueJobs(qb);
      }
    },
  });
}
