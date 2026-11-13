import { describe, expect, it } from "vitest";

import { helpText, parseCliArgs, UsageError } from "../src/args";

describe("parseCliArgs", () => {
  it("returns undefined for options that were not given", () => {
    expect(parseCliArgs([])).toEqual({
      directory: undefined,
      db: undefined,
      pm: undefined,
      example: undefined,
      install: undefined,
      git: undefined,
      yes: false,
      help: false,
      version: false,
    });
  });

  it("parses the directory and every option", () => {
    expect(
      parseCliArgs([
        "my-app",
        "--db",
        "postgres",
        "--pm=yarn",
        "--example",
        "blog",
        "--no-install",
        "--no-git",
        "-y",
      ]),
    ).toEqual({
      directory: "my-app",
      db: "postgres",
      pm: "yarn",
      example: "blog",
      install: false,
      git: false,
      yes: true,
      help: false,
      version: false,
    });
  });

  it("accepts the positive form of boolean flags", () => {
    const args = parseCliArgs(["--install", "--git"]);
    expect(args.install).toBe(true);
    expect(args.git).toBe(true);
  });

  it("parses help and version", () => {
    expect(parseCliArgs(["-h"]).help).toBe(true);
    expect(parseCliArgs(["--version"]).version).toBe(true);
  });

  it.each([
    [["--db", "mysql"], 'Unknown --db "mysql". Use one of: pglite, postgres, sqlite, memory.'],
    [["--pm", "deno"], 'Unknown --pm "deno". Use one of: pnpm, npm, yarn, bun.'],
    [["--example", "shop"], 'Unknown --example "shop". Use one of: blank, blog.'],
    [["a", "b"], "Expected one directory, got 2: a b"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(new UsageError(message));
  });

  it("rejects unknown options and missing values", () => {
    expect(() => parseCliArgs(["--force"])).toThrow(UsageError);
    expect(() => parseCliArgs(["--db"])).toThrow(UsageError);
  });

  it("documents every option in the help", () => {
    for (const flag of ["--db", "--pm", "--example", "--no-install", "--no-git", "--yes"]) {
      expect(helpText).toContain(flag);
    }
  });
});
