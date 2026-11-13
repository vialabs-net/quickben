import { relative } from "node:path";

import pc from "picocolors";

import { helpText, parseCliArgs, UsageError } from "./args";
import { installCommand, runScript } from "./pm";
import { CancelledError, resolveOptions } from "./prompts";
import { initGit } from "./run";
import { renderTemplate } from "./template";
import { assertEmptyTarget, TargetNotEmptyError, writeFiles } from "./write";

import type { ProjectOptions } from "./options";
import type { Prompter } from "./prompts";
import type { Runner } from "./run";

/** Everything the CLI needs from the outside world. */
export interface CliContext {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether stdin and stdout are terminals, so prompts can be shown. */
  isTTY: boolean;
  /** Directory with the stamped templates. */
  templateDir: string;
  version: string;
  prompter: Prompter;
  run: Runner;
  /** Print a line to stdout. */
  log: (line: string) => void;
  /** Print a line to stderr. */
  error: (line: string) => void;
}

function quote(path: string): string {
  return /^[\w./-]+$/.test(path) ? path : `"${path.replaceAll('"', '\\"')}"`;
}

function nextSteps(options: ProjectOptions, cwd: string, installed: boolean): string[] {
  const steps: string[] = [];
  const path = relative(cwd, options.directory);
  if (path !== "") steps.push(`cd ${quote(path)}`);
  if (!installed) {
    const install = installCommand(options.pm);
    steps.push([install.command, ...install.args].join(" "));
  }
  if (options.db === "postgres") steps.push("# set DATABASE_URL in .env.local");
  steps.push(runScript(options.pm, "dev"));
  return steps;
}

/** Create a project. Resolves with the exit code. */
export async function main(argv: readonly string[], ctx: CliContext): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      ctx.log(helpText);
      return 0;
    }
    if (args.version) {
      ctx.log(ctx.version);
      return 0;
    }
    const interactive = ctx.isTTY && !args.yes;
    if (interactive) ctx.prompter.intro(pc.bold("create-quickben"));
    const options = await resolveOptions(args, {
      interactive,
      prompter: ctx.prompter,
      cwd: ctx.cwd,
      userAgent: ctx.env.npm_config_user_agent,
    });
    return await scaffold(options, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.error(`${pc.red(error.message)}\nRun create-quickben --help for usage.`);
    } else if (error instanceof CancelledError || error instanceof TargetNotEmptyError) {
      ctx.error(pc.red(error.message));
    } else {
      ctx.error(pc.red(error instanceof Error ? error.message : String(error)));
    }
    return 1;
  }
}

/** Write the project, install dependencies and create the git repository. */
export async function scaffold(options: ProjectOptions, ctx: CliContext): Promise<number> {
  await assertEmptyTarget(options.directory);
  const files = await renderTemplate(ctx.templateDir, options);
  const env = files.get(".env.example");
  if (env !== undefined) files.set(".env.local", env);
  await writeFiles(options.directory, files);
  ctx.log(
    `${pc.green("Created")} ${options.name} in ${options.directory} (${options.db}, ${options.example}).`,
  );

  let installed = false;
  let exitCode = 0;
  if (options.install) {
    const install = installCommand(options.pm);
    ctx.log(`Installing dependencies with ${options.pm}…`);
    const code = await ctx.run(install.command, install.args, { cwd: options.directory });
    installed = code === 0;
    if (!installed) {
      ctx.error(pc.yellow(`${options.pm} install failed with exit code ${code}.`));
      exitCode = 1;
    }
  }

  if (options.git) {
    const result = await initGit(options.directory, ctx.run);
    if (result === "failed") ctx.error(pc.yellow("Could not create a git repository."));
    if (result === "initialized") {
      ctx.error(pc.yellow("Created a git repository, but could not make the first commit."));
    }
  }

  ctx.log("");
  ctx.log(pc.bold("Next steps:"));
  for (const step of nextSteps(options, ctx.cwd, installed)) ctx.log(`  ${pc.cyan(step)}`);
  ctx.log("");
  ctx.log(`Then open ${pc.underline("http://localhost:3000")} and /admin.`);
  return exitCode;
}
