import { beforeEach, describe, expect, it, vi } from "vitest";

const queues: {
  name: string;
  options: unknown;
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}[] = [];
const workers: {
  name: string;
  processor: (job: { data: unknown }) => Promise<void>;
  options: unknown;
  close: ReturnType<typeof vi.fn>;
}[] = [];

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn(() => Promise.resolve());
    remove = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    constructor(
      public name: string,
      public options: unknown,
    ) {
      queues.push(this);
    }
  },
  Worker: class {
    close = vi.fn(() => Promise.resolve());
    constructor(
      public name: string,
      public processor: (job: { data: unknown }) => Promise<void>,
      public options: unknown,
    ) {
      workers.push(this);
    }
  },
}));

const { bullmqRunner, connectionFromUrl } = await import("../src/bullmq");

beforeEach(() => {
  queues.length = 0;
  workers.length = 0;
});

describe("bullmqRunner", () => {
  it("queues one BullMQ job per run, without BullMQ retries", async () => {
    const runner = bullmqRunner({ connection: { url: "redis://localhost:6380" }, prefix: "dev" });
    expect(runner.inProcess).toBe(false);
    runner.start(() => Promise.resolve());
    expect(workers).toHaveLength(0);
    await runner.enqueue("job-1", 2);
    await runner.remove?.("job-1", 2);
    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("quickben-doc-reader");
    expect(queues[0]?.options).toMatchObject({
      prefix: "dev",
      connection: { host: "localhost", port: 6380 },
    });
    expect(queues[0]?.add).toHaveBeenCalledWith(
      "read",
      { jobId: "job-1", run: 2 },
      expect.objectContaining({ jobId: "job-1-2", attempts: 1 }),
    );
    expect(queues[0]?.remove).toHaveBeenCalledWith("job-1-2");
    await runner.close?.();
    expect(queues[0]?.close).toHaveBeenCalled();
  });

  it("consumes jobs in a worker process", async () => {
    const processor = vi.fn(() => Promise.resolve());
    const runner = bullmqRunner({
      connection: { host: "redis" },
      queueName: "reads",
      worker: { concurrency: 4 },
    });
    runner.start(processor);
    runner.start(processor);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.options).toMatchObject({ concurrency: 4, connection: { host: "redis" } });
    await workers[0]?.processor({ data: { jobId: "j", run: 1 } });
    expect(processor).toHaveBeenCalledWith("j", 1);
    const task = vi.fn(() => Promise.resolve());
    runner.background(task);
    expect(task).toHaveBeenCalled();
    await runner.close?.();
    expect(workers[0]?.close).toHaveBeenCalled();

    const deferred = vi.fn();
    const plain = bullmqRunner({ connection: { host: "redis" }, worker: true, defer: deferred });
    plain.start(processor);
    expect(workers[1]?.options).toMatchObject({ concurrency: 2 });
    plain.background(task);
    expect(deferred).toHaveBeenCalledWith(task);
  });

  it("parses Redis URLs", () => {
    expect(connectionFromUrl("rediss://user:p%40ss@cache.example.com:6390/2")).toEqual({
      host: "cache.example.com",
      port: 6390,
      username: "user",
      password: "p@ss",
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(connectionFromUrl("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });
});
