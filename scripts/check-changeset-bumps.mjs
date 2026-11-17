#!/usr/bin/env node
// Fails a pull request whose changesets ask for a minor or major bump while the package is on 0.x.
//
// While Quickben is 0.x every changeset is `patch`. All packages are in one `fixed` group, so a single
// `minor` changeset moves the whole repo to the next minor. The owner allows it with a label:
//
// | Label           | Allows           |
// | --------------- | ---------------- |
// | `release:minor` | `minor`          |
// | `release:major` | `minor`, `major` |
//
// In CI it reads the labels from the GitHub event payload (GITHUB_EVENT_PATH) and the changed
// changesets from `git diff`. No network.
//
//   node scripts/check-changeset-bumps.mjs [--base <ref>] [--label <name>]...
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUMPS = new Set(["patch", "minor", "major"]);

/** Parses the frontmatter of a changeset into `[{ name, bump }]`. Throws on a malformed file. */
export function parseChangeset(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0].trim() !== "---") throw new Error("missing frontmatter (first line must be ---)");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("frontmatter is not closed (no second ---)");
  const releases = [];
  for (const raw of lines.slice(1, end)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(["']?)([^"'\s]+?)\1\s*:\s*(["']?)(\w+)\3$/.exec(line);
    if (!match || !BUMPS.has(match[4])) throw new Error(`cannot read bump line: ${line}`);
    releases.push({ name: match[2], bump: match[4] });
  }
  return releases;
}

/** Major version of a semver string, or undefined. */
export function majorOf(version) {
  const match = /^(\d+)\./.exec(version ?? "");
  return match ? Number(match[1]) : undefined;
}

/**
 * Returns the bumps that break the 0.x rule.
 *
 * @param changesets `[{ file, releases }]`
 * @param versions `Map<packageName, version>` of the workspace packages
 * @param labels pull request label names
 */
export function findViolations(changesets, versions, labels) {
  const allowed = new Set(["patch"]);
  if (labels.includes("release:minor")) allowed.add("minor");
  if (labels.includes("release:major")) allowed.add("minor").add("major");
  const violations = [];
  for (const { file, releases } of changesets) {
    for (const { name, bump } of releases) {
      const version = versions.get(name);
      // An unknown package is treated as 0.x: Changesets rejects it anyway.
      const major = majorOf(version) ?? 0;
      if (major === 0 && !allowed.has(bump)) violations.push({ file, name, bump, version });
    }
  }
  return violations;
}

/** Builds the failure message. */
export function formatViolations(violations) {
  const lines = ["Changesets must be `patch` while Quickben is 0.x.", ""];
  for (const v of violations) {
    lines.push(`  ${v.file}: "${v.name}": ${v.bump} (current ${v.version ?? "unknown"})`);
  }
  const needsMajor = violations.some((v) => v.bump === "major");
  lines.push(
    "",
    "To fix: change the bump to `patch` in the files above.",
    `If the owner wants this release, the owner adds the label \`${needsMajor ? "release:major" : "release:minor"}\` to the pull request.`,
  );
  return lines.join("\n");
}

/** Changeset files (`.changeset/*.md`, not README) added, changed or renamed since `base`. */
export function changedChangesets(root, base) {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`, "--", ".changeset/*.md"],
    { cwd: root, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f !== "" && path.posix.dirname(f) === ".changeset")
    .filter((f) => path.posix.basename(f).toLowerCase() !== "readme.md");
}

/** `Map<name, version>` of every package.json under packages/ and apps/. */
export function workspaceVersions(root) {
  const versions = new Map();
  for (const dir of ["packages", "apps"]) {
    const base = path.join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = path.join(base, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name) versions.set(pkg.name, pkg.version);
    }
  }
  return versions;
}

/** Labels and base SHA from a pull_request event payload. */
export function readEvent(eventPath) {
  if (!eventPath || !existsSync(eventPath)) return { labels: [], base: undefined };
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request ?? {};
  return { labels: (pr.labels ?? []).map((l) => l.name), base: pr.base?.sha };
}

function parseArgs(argv) {
  const args = { base: undefined, labels: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--label") args.labels.push(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

/** Runs the check. Returns the process exit code. */
export function main({ root, argv, env, log = console.log, error = console.error }) {
  const args = parseArgs(argv);
  const event = readEvent(env.GITHUB_EVENT_PATH);
  const base = args.base ?? event.base ?? "origin/trunk";
  const labels = [...event.labels, ...args.labels];

  const files = changedChangesets(root, base);
  if (files.length === 0) {
    log("No changesets added or changed.");
    return 0;
  }
  const changesets = [];
  for (const file of files) {
    try {
      changesets.push({
        file,
        releases: parseChangeset(readFileSync(path.join(root, file), "utf8")),
      });
    } catch (e) {
      error(`${file}: ${e.message}`);
      return 1;
    }
  }
  const violations = findViolations(changesets, workspaceVersions(root), labels);
  if (violations.length > 0) {
    error(formatViolations(violations));
    return 1;
  }
  log(`Changeset bumps are fine (${files.join(", ")}).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main({
    root: path.resolve(import.meta.dirname, ".."),
    argv: process.argv.slice(2),
    env: process.env,
  });
}
