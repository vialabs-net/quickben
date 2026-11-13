import type { PackageManager } from "./options";

/**
 * The package manager that runs the CLI, from `npm_config_user_agent`
 * (e.g. `pnpm/10.0.0 npm/? node/v24.0.0 darwin arm64`). Defaults to npm.
 */
export function detectPackageManager(userAgent: string | undefined): PackageManager {
  const name = userAgent?.split("/", 1)[0];
  if (name === "pnpm" || name === "yarn" || name === "bun") return name;
  return "npm";
}

/** The install command. */
export function installCommand(pm: PackageManager): { command: PackageManager; args: string[] } {
  return { command: pm, args: ["install"] };
}

/** The prefix that runs a package script: `pnpm`, `yarn`, `npm run` or `bun run`. */
export function runPrefix(pm: PackageManager): string {
  return pm === "npm" || pm === "bun" ? `${pm} run` : pm;
}

/** How to run a package script, e.g. `pnpm dev` or `npm run dev`. */
export function runScript(pm: PackageManager, script: string): string {
  return `${runPrefix(pm)} ${script}`;
}
