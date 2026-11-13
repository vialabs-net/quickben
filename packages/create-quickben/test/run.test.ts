import { describe, expect, it } from "vitest";

import { initGit, spawnRunner } from "../src/run";

import { tempDir } from "./helpers";

import type { Runner } from "../src/run";

/** A runner that answers with exit codes per git subcommand and records the calls. */
function fakeRunner(codes: Record<string, number>): Runner & { calls: string[] } {
  const calls: string[] = [];
  const run: Runner = (command, args) => {
    const key = `${command} ${args[0] ?? ""}`;
    calls.push(key);
    return Promise.resolve(codes[key] ?? 0);
  };
  return Object.assign(run, { calls });
}

describe("spawnRunner", () => {
  it("resolves with the exit code", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      expect(await spawnRunner(process.execPath, ["-e", "process.exit(3)"], { cwd: dir })).toBe(3);
      expect(
        await spawnRunner(process.execPath, ["-e", "console.log('hi')"], { cwd: dir, quiet: true }),
      ).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("resolves with 127 when the command is missing", async () => {
    expect(
      await spawnRunner("create-quickben-missing-command", [], { cwd: process.cwd(), quiet: true }),
    ).toBe(127);
  });
});

describe("initGit", () => {
  it("creates a repository with a first commit", async () => {
    const run = fakeRunner({ "git rev-parse": 128 });
    expect(await initGit("/app", run)).toBe("committed");
    expect(run.calls).toEqual(["git rev-parse", "git init", "git add", "git commit"]);
  });

  it("skips inside an existing work tree", async () => {
    const run = fakeRunner({ "git rev-parse": 0 });
    expect(await initGit("/app", run)).toBe("inside-repo");
    expect(run.calls).toEqual(["git rev-parse"]);
  });

  it("reports a failed init", async () => {
    expect(await initGit("/app", fakeRunner({ "git rev-parse": 128, "git init": 1 }))).toBe(
      "failed",
    );
  });

  it("keeps the repository when add or commit fail", async () => {
    expect(await initGit("/app", fakeRunner({ "git rev-parse": 128, "git add": 1 }))).toBe(
      "initialized",
    );
    expect(await initGit("/app", fakeRunner({ "git rev-parse": 128, "git commit": 1 }))).toBe(
      "initialized",
    );
  });

  it("works with real git", async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const result = await initGit(dir, spawnRunner);
      // The commit needs a git identity, which CI runners may lack.
      expect(["committed", "initialized"]).toContain(result);
      expect(await spawnRunner("git", ["rev-parse", "--git-dir"], { cwd: dir, quiet: true })).toBe(
        0,
      );
    } finally {
      await cleanup();
    }
  });
});
