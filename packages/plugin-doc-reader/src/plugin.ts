import { definePlugin } from "@quickben/core";

import {
  docJobsCollection,
  docQuotasCollection,
  docSamplesCollection,
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
>;

/**
 * Document reading. Adds `doc-types`, `doc-samples`, `doc-test-runs`, `doc-jobs`, `doc-usage`
 * and `doc-quotas`. Read documents with `readDocument(qb, input, ctx)`.
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
    ],
    onInit: async (qb) => {
      state.rootQb = qb;
      register(qb.config, state);
      await seedTypes(qb, state.types);
      state.runner.start((jobId, run) => processJob(qb, jobId, run));
      if (state.runner.inProcess) {
        await failInterruptedJobs(qb);
        await requeueJobs(qb);
      }
    },
  });
}
