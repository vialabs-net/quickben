import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { main } from "../src/cli";
import { CancelledError } from "../src/prompts";

import { scriptedPrompter, stampedTemplates, tempDir } from "./helpers";

import type { CliContext } from "../src/cli";
import type { Prompter } from "../src/prompts";
import type { Runner } from "../src/run";

let root: string;
let templateDir: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir: root, cleanup } = await tempDir());
  templateDir = await stampedTemplates(root);
});
afterAll(() => cleanup());

interface Harness {
  ctx: CliContext;
  out: string[];
  err: string[];
  calls: string[];
}

/** A CLI context in `root` that records output and commands. */
function harness(
  options: { prompter?: Prompter; isTTY?: boolean; codes?: Record<string, number> } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const run: Runner = (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const code = Object.entries(options.codes ?? {}).find(([prefix]) => key.startsWith(prefix));
    return Promise.resolve(code?.[1] ?? (command === "git" && args[0] === "rev-parse" ? 128 : 0));
  };
  const ctx: CliContext = {
    cwd: root,
    env: { npm_config_user_agent: "pnpm/12.18.0 npm/? node/v24.14.0" },
    isTTY: options.isTTY ?? false,
    templateDir,
    version: "1.2.3",
    prompter: options.prompter ?? scriptedPrompter([]),
    run,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  return { ctx, out, err, calls };
}

// picocolors may color the output; compare without escape codes.
// eslint-disable-next-line no-control-regex
const plain = (lines: string[]) => lines.join("\n").replaceAll(/\u001b\[\d+m/g, "");

describe("main", () => {
  it("prints the help and the version", async () => {
    const help = harness();
    expect(await main(["--help"], help.ctx)).toBe(0);
    expect(help.out[0]).toContain("Usage: create-quickben");
    const version = harness();
    expect(await main(["-v"], version.ctx)).toBe(0);
    expect(version.out).toEqual(["1.2.3"]);
  });

  it("reports usage errors", async () => {
    const h = harness();
    expect(await main(["--db", "oracle"], h.ctx)).toBe(1);
    expect(plain(h.err)).toContain('Unknown --db "oracle"');
    expect(plain(h.err)).toContain("--help");
  });

  it("creates, installs and commits a project", async () => {
    const h = harness();
    expect(await main(["installed", "--yes"], h.ctx)).toBe(0);
    expect(h.calls).toEqual([
      "pnpm install",
      "git rev-parse --is-inside-work-tree",
      "git init --quiet",
      "git add --all",
      "git commit --quiet --message Initial commit from create-quickben",
    ]);
    const dir = join(root, "installed");
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
    };
    expect(manifest.name).toBe("installed");
    expect(await readFile(join(dir, ".env.local"), "utf8")).toBe(
      await readFile(join(dir, ".env.example"), "utf8"),
    );
    const output = plain(h.out);
    expect(output).toContain(`Created installed in ${dir} (pglite, blank).`);
    expect(output).toContain("  cd installed\n  pnpm dev");
    expect(output).not.toContain("pnpm install\n");
    expect(h.err).toEqual([]);
  });

  it("skips install and git with --no-install --no-git", async () => {
    const h = harness();
    const code = await main(
      ["plain", "--no-install", "--no-git", "--db", "postgres", "--pm", "npm"],
      h.ctx,
    );
    expect(code).toBe(0);
    expect(h.calls).toEqual([]);
    const output = plain(h.out);
    expect(output).toContain("npm install");
    expect(output).toContain("# set DATABASE_URL in .env.local");
    expect(output).toContain("npm run dev");
  });

  it("quotes directories with spaces in the next steps", async () => {
    const h = harness();
    expect(await main(["My App", "--yes", "--no-install", "--no-git"], h.ctx)).toBe(0);
    expect(plain(h.out)).toContain('cd "My App"');
    expect(await readFile(join(root, "My App/package.json"), "utf8")).toContain('"my-app"');
  });

  it("omits cd when the project is the current directory", async () => {
    const h = harness();
    h.ctx.cwd = join(root, "here");
    expect(await main([".", "--yes", "--no-install", "--no-git"], h.ctx)).toBe(0);
    expect(plain(h.out)).not.toContain("cd ");
  });

  it("returns 1 and still prints next steps when install fails", async () => {
    const h = harness({ codes: { "pnpm install": 1 } });
    expect(await main(["broken", "--yes", "--no-git"], h.ctx)).toBe(1);
    expect(plain(h.err)).toContain("pnpm install failed with exit code 1.");
    expect(plain(h.out)).toContain("pnpm install\n");
  });

  it("warns when git fails", async () => {
    const failed = harness({ codes: { "git init": 1 } });
    expect(await main(["git-failed", "--yes", "--no-install"], failed.ctx)).toBe(0);
    expect(plain(failed.err)).toContain("Could not create a git repository.");
    const noCommit = harness({ codes: { "git commit": 1 } });
    expect(await main(["git-no-commit", "--yes", "--no-install"], noCommit.ctx)).toBe(0);
    expect(plain(noCommit.err)).toContain("could not make the first commit");
  });

  it("refuses a directory that is not empty", async () => {
    await writeFile(join(root, "taken.txt"), "");
    const h = harness();
    h.ctx.cwd = root;
    expect(await main([".", "--yes"], h.ctx)).toBe(1);
    expect(plain(h.err)).toContain("is not empty");
  });

  it("prompts in a terminal", async () => {
    const prompter = scriptedPrompter(["prompted", "memory", "blog", "yarn", false, false]);
    let intro = "";
    prompter.intro = (title) => {
      intro = title;
    };
    const h = harness({ prompter, isTTY: true });
    expect(await main([], h.ctx)).toBe(0);
    expect(plain([intro])).toBe("create-quickben");
    expect(plain(h.out)).toContain("Created prompted");
    expect(plain(h.out)).toContain("(memory, blog)");
    expect(await readFile(join(root, "prompted/lib/seed.ts"), "utf8")).toContain("seedIfEmpty");
  });

  it("does not prompt with --yes in a terminal", async () => {
    const prompter = scriptedPrompter([]);
    const h = harness({ prompter, isTTY: true });
    expect(await main(["yes-tty", "--yes", "--no-install", "--no-git"], h.ctx)).toBe(0);
    expect(prompter.asked).toEqual([]);
  });

  it("reports a cancelled prompt", async () => {
    const prompter = scriptedPrompter([]);
    prompter.text = () => Promise.reject(new CancelledError());
    const h = harness({ prompter, isTTY: true });
    expect(await main([], h.ctx)).toBe(1);
    expect(plain(h.err)).toBe("Cancelled.");
  });

  it("reports other errors", async () => {
    const h = harness();
    h.ctx.templateDir = join(root, "missing");
    expect(await main(["no-templates", "--yes"], h.ctx)).toBe(1);
    expect(plain(h.err)).toContain("ENOENT");
    const thrown = harness();
    thrown.ctx.prompter.text = () => Promise.reject(new Error("boom"));
    thrown.ctx.isTTY = true;
    expect(await main([], thrown.ctx)).toBe(1);
    expect(plain(thrown.err)).toBe("boom");
    const odd = harness({ isTTY: true });
    // Code outside the CLI may reject with something that is not an Error.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    odd.ctx.prompter.text = () => Promise.reject("plain string");
    expect(await main([], odd.ctx)).toBe(1);
    expect(plain(odd.err)).toBe("plain string");
  });
});
