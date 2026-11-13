import { resolve } from "node:path";

import * as clack from "@clack/prompts";

import { UsageError } from "./args";
import { databaseChoices, defaults, exampleChoices, packageManagers } from "./options";
import { detectPackageManager } from "./pm";
import { validateDirectory, packageName } from "./project";

import type { CliArgs } from "./args";
import type { Choice, PackageManager, ProjectOptions } from "./options";

/** The user pressed Ctrl+C or Escape in a prompt. */
export class CancelledError extends Error {
  override name = "CancelledError";
  constructor() {
    super("Cancelled.");
  }
}

/** Questions the CLI asks. Swappable in tests. */
export interface Prompter {
  intro(title: string): void;
  text(options: {
    message: string;
    placeholder: string;
    validate: (value: string) => string | undefined;
  }): Promise<string>;
  select<T extends string>(options: {
    message: string;
    options: readonly Choice<T>[];
    initialValue: T;
  }): Promise<T>;
  confirm(options: { message: string; initialValue: boolean }): Promise<boolean>;
}

function unlessCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as T;
}

/** A {@link Prompter} on `@clack/prompts`. */
export function clackPrompter(): Prompter {
  return {
    intro: (title) => {
      clack.intro(title);
    },
    text: async ({ message, placeholder, validate }) =>
      unlessCancelled<string>(
        await clack.text({
          message,
          placeholder,
          defaultValue: placeholder,
          validate: (value) => validate(value ?? placeholder),
        }),
      ),
    select: async <T extends string>({
      message,
      options,
      initialValue,
    }: {
      message: string;
      options: readonly Choice<T>[];
      initialValue: T;
    }) =>
      unlessCancelled<T>(
        await clack.select<T>({
          message,
          initialValue,
          options: options.map((option) => ({ ...option })) as never,
        }),
      ),
    confirm: async (options) => unlessCancelled<boolean>(await clack.confirm(options)),
  };
}

export interface ResolveContext {
  /** Ask for options that were not given. */
  interactive: boolean;
  prompter: Prompter;
  cwd: string;
  /** `npm_config_user_agent`, to pick the default package manager. */
  userAgent: string | undefined;
}

const pmChoices: readonly Choice<PackageManager>[] = packageManagers.map((pm) => ({
  value: pm,
  label: pm,
  hint: "",
}));

/** Fill in options from the arguments, then prompts (interactive) or defaults. */
export async function resolveOptions(args: CliArgs, ctx: ResolveContext): Promise<ProjectOptions> {
  const { prompter, interactive } = ctx;
  if (args.directory !== undefined) {
    const error = validateDirectory(args.directory);
    if (error) throw new UsageError(error);
  }
  const directory =
    args.directory ??
    (interactive
      ? await prompter.text({
          message: "Where should the project go?",
          placeholder: defaults.directory,
          validate: validateDirectory,
        })
      : defaults.directory);
  const db =
    args.db ??
    (interactive
      ? await prompter.select({
          message: "Database",
          options: databaseChoices,
          initialValue: defaults.db,
        })
      : defaults.db);
  const example =
    args.example ??
    (interactive
      ? await prompter.select({
          message: "Starter",
          options: exampleChoices,
          initialValue: defaults.example,
        })
      : defaults.example);
  const detected = detectPackageManager(ctx.userAgent);
  const pm =
    args.pm ??
    (interactive
      ? await prompter.select({
          message: "Package manager",
          options: pmChoices,
          initialValue: detected,
        })
      : detected);
  const install =
    args.install ??
    (interactive
      ? await prompter.confirm({
          message: `Install dependencies with ${pm}?`,
          initialValue: defaults.install,
        })
      : defaults.install);
  const git =
    args.git ??
    (interactive
      ? await prompter.confirm({
          message: "Create a git repository?",
          initialValue: defaults.git,
        })
      : defaults.git);
  return {
    directory: resolve(ctx.cwd, directory),
    name: packageName(directory),
    db,
    pm,
    example,
    install,
    git,
  };
}
