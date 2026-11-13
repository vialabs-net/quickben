import { spawn } from "node:child_process";

/** The only commands the CLI runs. */
const commands = { git: "git", npm: "npm", pnpm: "pnpm", yarn: "yarn", bun: "bun" } as const;

/** A command the CLI may run. */
export type Command = keyof typeof commands;

/** Arguments are fixed strings from the CLI: letters, digits, spaces and `-./:=_`. */
const safeArgument = /^[\w ./:=-]+$/;

/** Run a command and resolve with its exit code. `quiet` hides its output. */
export type Runner = (
  command: Command,
  args: readonly string[],
  options: { cwd: string; quiet?: boolean },
) => Promise<number>;

/**
 * A {@link Runner} on `child_process.spawn`. Exit code 127 when the command is missing or not
 * allowed, or an argument has other characters.
 */
export const spawnRunner: Runner = (command, args, { cwd, quiet = false }) =>
  new Promise((resolve) => {
    const executable = Object.hasOwn(commands, command) ? commands[command] : undefined;
    if (executable === undefined || !args.every((arg) => safeArgument.test(arg))) {
      resolve(127);
      return;
    }
    const stdio = quiet ? "ignore" : "inherit";
    // npm, pnpm and yarn are .cmd files on Windows, which need a shell.
    const child =
      process.platform === "win32"
        ? spawn([executable, ...args.map((arg) => `"${arg}"`)].join(" "), {
            cwd,
            stdio,
            shell: true,
          })
        : spawn(executable, [...args], { cwd, stdio });
    child.on("error", () => {
      resolve(127);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });

/** What {@link initGit} did. */
export type GitResult = "committed" | "initialized" | "inside-repo" | "failed";

/**
 * Create a git repository with a first commit. Skipped inside an existing work tree. The
 * commit fails without a git identity; the repository is kept.
 */
export async function initGit(cwd: string, run: Runner): Promise<GitResult> {
  const quiet = { cwd, quiet: true };
  if ((await run("git", ["rev-parse", "--is-inside-work-tree"], quiet)) === 0) {
    return "inside-repo";
  }
  if ((await run("git", ["init", "--quiet"], quiet)) !== 0) return "failed";
  if ((await run("git", ["add", "--all"], quiet)) !== 0) return "initialized";
  const commit = await run(
    "git",
    ["commit", "--quiet", "--message", "Initial commit from create-quickben"],
    quiet,
  );
  return commit === 0 ? "committed" : "initialized";
}
