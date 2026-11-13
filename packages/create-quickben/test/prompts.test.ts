import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, UsageError } from "../src/args";
import { CancelledError, clackPrompter, resolveOptions } from "../src/prompts";

import { scriptedPrompter } from "./helpers";

const clack = vi.hoisted(() => ({
  cancel: Symbol("cancel"),
  intro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  intro: clack.intro,
  text: clack.text,
  select: clack.select,
  confirm: clack.confirm,
  isCancel: (value: unknown) => value === clack.cancel,
}));

afterEach(() => {
  vi.clearAllMocks();
});

const cwd = "/work";
const pnpmAgent = "pnpm/12.18.0 npm/? node/v24.14.0 darwin arm64";

describe("resolveOptions", () => {
  it("asks for every option that was not given", async () => {
    const prompter = scriptedPrompter(["shop", "sqlite", "blog", "bun", false, true]);
    const options = await resolveOptions(parseCliArgs([]), {
      interactive: true,
      prompter,
      cwd,
      userAgent: pnpmAgent,
    });
    expect(options).toEqual({
      directory: resolve(cwd, "shop"),
      name: "shop",
      db: "sqlite",
      pm: "bun",
      example: "blog",
      install: false,
      git: true,
    });
    expect(prompter.asked).toEqual([
      "Where should the project go?",
      "Database",
      "Starter",
      "Package manager",
      "Install dependencies with bun?",
      "Create a git repository?",
    ]);
  });

  it("asks nothing when every option is given", async () => {
    const prompter = scriptedPrompter([]);
    const args = parseCliArgs([
      "app",
      "--db=memory",
      "--example=blank",
      "--pm=npm",
      "--install",
      "--no-git",
    ]);
    const options = await resolveOptions(args, {
      interactive: true,
      prompter,
      cwd,
      userAgent: undefined,
    });
    expect(options).toMatchObject({ name: "app", db: "memory", pm: "npm", git: false });
    expect(prompter.asked).toEqual([]);
  });

  it("uses defaults and the detected package manager when not interactive", async () => {
    const options = await resolveOptions(parseCliArgs([]), {
      interactive: false,
      prompter: scriptedPrompter([]),
      cwd,
      userAgent: pnpmAgent,
    });
    expect(options).toEqual({
      directory: resolve(cwd, "quickben-app"),
      name: "quickben-app",
      db: "pglite",
      pm: "pnpm",
      example: "blank",
      install: true,
      git: true,
    });
  });

  it("rejects a directory argument without a valid name", async () => {
    await expect(
      resolveOptions(parseCliArgs(["!!!"]), {
        interactive: false,
        prompter: scriptedPrompter([]),
        cwd,
        userAgent: undefined,
      }),
    ).rejects.toThrow(UsageError);
  });
});

describe("clackPrompter", () => {
  const prompter = clackPrompter();

  it("shows the intro", () => {
    prompter.intro("create-quickben");
    expect(clack.intro).toHaveBeenCalledWith("create-quickben");
  });

  it("asks for text, with the placeholder as default", async () => {
    clack.text.mockResolvedValue("my-app");
    const validate = vi.fn(() => undefined);
    expect(await prompter.text({ message: "Dir?", placeholder: "quickben-app", validate })).toBe(
      "my-app",
    );
    const options = clack.text.mock.calls[0]?.[0] as {
      defaultValue: string;
      validate: (value: string | undefined) => unknown;
    };
    expect(options.defaultValue).toBe("quickben-app");
    options.validate(undefined);
    options.validate("x");
    expect(validate.mock.calls).toEqual([["quickben-app"], ["x"]]);
  });

  it("selects and confirms", async () => {
    clack.select.mockResolvedValue("postgres");
    clack.confirm.mockResolvedValue(false);
    expect(
      await prompter.select({
        message: "Database",
        options: [{ value: "postgres", label: "Postgres", hint: "" }],
        initialValue: "postgres",
      }),
    ).toBe("postgres");
    expect(clack.select).toHaveBeenCalledWith({
      message: "Database",
      initialValue: "postgres",
      options: [{ value: "postgres", label: "Postgres", hint: "" }],
    });
    expect(await prompter.confirm({ message: "Install?", initialValue: true })).toBe(false);
  });

  it("throws CancelledError when the user cancels", async () => {
    clack.confirm.mockResolvedValue(clack.cancel);
    await expect(prompter.confirm({ message: "Install?", initialValue: true })).rejects.toThrow(
      CancelledError,
    );
  });
});
