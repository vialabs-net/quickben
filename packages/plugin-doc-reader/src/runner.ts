/**
 * How jobs reach a worker. The database keeps the job record; a runner only carries
 * `(jobId, run)` to whatever calls the processor.
 */

/** Runs one job. The plugin passes it to the runner when Quickben starts. */
export type JobProcessor = (jobId: string, run: number) => Promise<void>;

/** A deferred task, e.g. Next.js `after` so a serverless function stays alive until it ends. */
export type Defer = (task: () => Promise<void>) => void;

export interface JobRunner {
  readonly name: string;
  /**
   * `true` when queued jobs live only in this process. Jobs still `queued` in the database
   * when Quickben starts are then queued again.
   */
  readonly inProcess: boolean;
  /** Called once with the processor, after the database is ready. */
  start(processor: JobProcessor): void;
  /** Queue one run of a job. */
  enqueue(jobId: string, run: number): Promise<void>;
  /** Drop a queued run, when the job is cancelled. Best effort. */
  remove?(jobId: string, run: number): Promise<void>;
  /** Run a background task in this process (test runs of the studio). */
  background(task: () => Promise<void>): void;
  /** Stop taking work. */
  close?(): Promise<void>;
}

export interface InProcessRunnerOptions {
  /** Jobs run at the same time. Default 2. */
  concurrency?: number;
  /**
   * How work is scheduled. Default: start it now and do not wait. In Next.js pass `after` from
   * `next/server`, so the response is sent first and a serverless function stays alive until
   * the job ends.
   */
  defer?: Defer;
}

/** Background tasks still running in this process, for tests and graceful shutdowns. */
export interface Idle {
  /** Resolves when nothing is queued or running. */
  idle(): Promise<void>;
}

/**
 * The default runner: jobs run in the process that queued them. Good for development, one
 * server, and serverless with `defer: after`. Use the BullMQ runner to read in separate worker
 * processes.
 */
export function inProcessRunner(options: InProcessRunnerOptions = {}): JobRunner & Idle {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const defer: Defer =
    options.defer ??
    ((task) => {
      void task();
    });
  const queue: { jobId: string; run: number }[] = [];
  const tasks = new Set<Promise<void>>();
  let processor: JobProcessor | undefined;
  let running = 0;

  const track = (task: () => Promise<void>): Promise<void> => {
    const promise = task().finally(() => tasks.delete(promise));
    tasks.add(promise);
    return promise;
  };

  async function drain(): Promise<void> {
    while (processor && running < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      running += 1;
      try {
        await processor(next.jobId, next.run);
      } catch {
        // The processor records failures on the job itself.
      } finally {
        running -= 1;
      }
    }
  }

  return {
    name: "in-process",
    inProcess: true,
    start(fn) {
      processor = fn;
      if (queue.length > 0) defer(() => track(drain));
    },
    enqueue(jobId, run) {
      queue.push({ jobId, run });
      defer(() => track(drain));
      return Promise.resolve();
    },
    remove(jobId, run) {
      const index = queue.findIndex((item) => item.jobId === jobId && item.run === run);
      if (index !== -1) queue.splice(index, 1);
      return Promise.resolve();
    },
    background(task) {
      defer(() => track(task));
    },
    async idle() {
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },
  };
}
