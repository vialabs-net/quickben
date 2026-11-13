import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { stampTemplates, workspaceVersions } from "../src/stamp";

import type { Prompter } from "../src/prompts";

export const packageDir = resolve(import.meta.dirname, "..");
export const sourceTemplates = join(packageDir, "templates");

/** A temp directory, removed by the returned cleanup. */
export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "create-quickben-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Stamp the source templates into `dir/templates`, as the build does. */
export async function stampedTemplates(dir: string): Promise<string> {
  const out = join(dir, "templates");
  await stampTemplates(sourceTemplates, out, await workspaceVersions(resolve(packageDir, "..")));
  return out;
}

/** A prompter that answers from a queue and records the questions. */
export function scriptedPrompter(answers: unknown[]): Prompter & { asked: string[] } {
  const asked: string[] = [];
  const next = <T>(message: string): Promise<T> => {
    asked.push(message);
    if (answers.length === 0) throw new Error(`No answer for "${message}"`);
    return Promise.resolve(answers.shift() as T);
  };
  return {
    asked,
    intro: () => undefined,
    text: ({ message }) => next(message),
    select: ({ message }) => next(message),
    confirm: ({ message }) => next(message),
  };
}
