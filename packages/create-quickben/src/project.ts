import { basename, resolve } from "node:path";

/**
 * A valid npm package name from a directory: the last path segment, lowercased, with other
 * characters replaced by `-`.
 */
export function packageName(directory: string): string {
  let name = basename(resolve(directory))
    .toLowerCase()
    .replaceAll(/[^a-z\d._~-]+/g, "-")
    .replace(/^[._-]+/, "");
  while (name.endsWith("-")) name = name.slice(0, -1);
  return name;
}

/** An error message for a directory that cannot hold a project, or `undefined`. */
export function validateDirectory(directory: string): string | undefined {
  if (directory.trim() === "") return "Enter a directory.";
  if (packageName(directory) === "") {
    return `"${directory}" does not give a valid package name. Use letters, digits and dashes.`;
  }
  if (packageName(directory).length > 214) return "The directory name is too long.";
  return undefined;
}
