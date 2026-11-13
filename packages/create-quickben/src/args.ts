import { parseArgs } from "node:util";

import { databases, examples, packageManagers } from "./options";

import type { Database, Example, PackageManager } from "./options";

/** Wrong command-line usage. The message is shown with the help hint. */
export class UsageError extends Error {
  override name = "UsageError";
}

/** Command-line arguments. Options that were not given are `undefined`. */
export interface CliArgs {
  directory?: string;
  db?: Database;
  pm?: PackageManager;
  example?: Example;
  install?: boolean;
  git?: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
}

export const helpText = `Usage: create-quickben [directory] [options]

Create a Next.js app with Quickben.

Options:
  --db <name>        pglite (default), postgres, sqlite or memory
  --example <name>   blank (default) or blog
  --pm <name>        pnpm, npm, yarn or bun (default: the one running this command)
  --no-install       Do not install dependencies
  --no-git           Do not create a git repository
  -y, --yes          Use defaults for every option not given, without prompts
  -h, --help         Show this help
  -v, --version      Show the version

Examples:
  pnpm create quickben my-app
  npm create quickben@latest my-app -- --db postgres --example blog
  npx create-quickben my-app --yes --no-install`;

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`Unknown ${flag} "${value}". Use one of: ${allowed.join(", ")}.`);
}

/** Parse `process.argv.slice(2)`. Throws {@link UsageError}. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      allowNegative: true,
      strict: true,
      options: {
        db: { type: "string" },
        pm: { type: "string" },
        example: { type: "string" },
        install: { type: "boolean" },
        git: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected one directory, got ${positionals.length}: ${positionals.join(" ")}`,
    );
  }
  return {
    directory: positionals[0],
    db: oneOf(values.db, databases, "--db"),
    pm: oneOf(values.pm, packageManagers, "--pm"),
    example: oneOf(values.example, examples, "--example"),
    install: values.install,
    git: values.git,
    yes: values.yes ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}
