/**
 * `@quickben/plugin-doc-reader/bullmq`: a runner that carries jobs over Redis with BullMQ, so
 * documents are read in worker processes instead of the web server.
 *
 * ```ts
 * docReader({ runner: bullmqRunner({ connection: { url: process.env.REDIS_URL }, worker: isWorker }) })
 * ```
 */
import { Queue, Worker } from "bullmq";

import type { Defer, JobProcessor, JobRunner } from "./runner";
import type { ConnectionOptions } from "bullmq";

export const DEFAULT_QUEUE = "quickben-doc-reader";

export interface BullmqRunnerOptions {
  /** Redis connection: `{ url }` or ioredis options. */
  connection: ConnectionOptions | { url: string };
  /** Queue name. Default `quickben-doc-reader`. */
  queueName?: string;
  /**
   * Key prefix. Set it when processes of another environment share the Redis, or they consume
   * each other's jobs. A queue and its workers must use the same prefix.
   */
  prefix?: string;
  /**
   * Consume jobs in this process. `true`, or `{ concurrency }` (default 2). Leave it off in the
   * web server and turn it on in worker processes.
   */
  worker?: boolean | { concurrency?: number };
  /** How test runs of the studio are scheduled in this process. Default: start them now. */
  defer?: Defer;
}

interface ReadJobData {
  readonly jobId: string;
  readonly run: number;
}

/** BullMQ ids cannot contain `:`. One id per run, so a retry is a new job. */
const bullId = (jobId: string, run: number) => `${jobId}-${String(run)}`;

/** Parse `redis://` and `rediss://` URLs into BullMQ connection options. */
export function connectionFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db !== undefined && Number.isInteger(db) ? { db } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    // A finite value makes ioredis give up on a worker's blocking wait after a Redis hiccup,
    // and the worker stops consuming without an error.
    maxRetriesPerRequest: null,
  };
}

/** A runner that queues jobs in BullMQ. Workers can run in any process with the same config. */
export function bullmqRunner(options: BullmqRunnerOptions): JobRunner {
  const connection =
    "url" in options.connection && typeof options.connection.url === "string"
      ? connectionFromUrl(options.connection.url)
      : (options.connection as ConnectionOptions);
  const name = options.queueName ?? DEFAULT_QUEUE;
  const shared = { connection, ...(options.prefix ? { prefix: options.prefix } : {}) };
  const defer: Defer =
    options.defer ??
    ((task) => {
      void task();
    });
  let queue: Queue<ReadJobData> | undefined;
  let worker: Worker<ReadJobData> | undefined;
  const getQueue = () => (queue ??= new Queue<ReadJobData>(name, shared));

  return {
    name: "bullmq",
    inProcess: false,
    start(processor: JobProcessor) {
      if (!options.worker || worker) return;
      const concurrency = options.worker === true ? 2 : (options.worker.concurrency ?? 2);
      worker = new Worker<ReadJobData>(
        name,
        async (job) => {
          await processor(job.data.jobId, job.data.run);
        },
        { ...shared, concurrency },
      );
    },
    async enqueue(jobId, run) {
      await getQueue().add(
        "read",
        { jobId, run },
        {
          jobId: bullId(jobId, run),
          // The plugin records failures on the job itself; a BullMQ retry would run the paid
          // extractors twice.
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    },
    async remove(jobId, run) {
      await getQueue().remove(bullId(jobId, run));
    },
    background(task) {
      defer(task);
    },
    async close() {
      await Promise.all([worker?.close(), queue?.close()]);
    },
  };
}

export type { JobRunner } from "./runner";
