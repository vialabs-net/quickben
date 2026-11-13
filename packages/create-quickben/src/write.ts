import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FileMap } from "./template";

/** Entries that may already be in the target directory. */
const allowedEntries = new Set([".DS_Store", "Thumbs.db", ".git", ".idea", ".vscode", "LICENSE"]);

/** The target directory already has files. */
export class TargetNotEmptyError extends Error {
  override name = "TargetNotEmptyError";
}

/** Throw unless `directory` is missing or empty (apart from a few harmless entries). */
export async function assertEmptyTarget(directory: string): Promise<void> {
  let info;
  try {
    info = await stat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!info.isDirectory()) throw new TargetNotEmptyError(`${directory} is a file.`);
  const conflicts = (await readdir(directory)).filter((entry) => !allowedEntries.has(entry));
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 5).join(", ");
    const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : "";
    throw new TargetNotEmptyError(
      `${directory} is not empty (${shown}${more}). Pick a new or empty directory.`,
    );
  }
}

/** Write every file under `directory`, creating directories as needed. */
export async function writeFiles(directory: string, files: FileMap): Promise<void> {
  for (const [path, content] of files) {
    const target = join(directory, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
