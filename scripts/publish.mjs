#!/usr/bin/env node
// Publishes every public workspace package whose version is not on npm yet.
//
// - In GitHub Actions it relies on npm Trusted Publishing (OIDC): no token, and
//   npm adds provenance on its own. Needs npm >= 11.5.1 and `id-token: write`.
// - Locally (`node scripts/publish.mjs --local`, after `npm login`) it publishes
//   without provenance. Use it once per new package, because npm only lets you
//   link a trusted publisher to a package that already exists.
//
// `pnpm pack` turns `workspace:` ranges into real versions before npm sees them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const local = process.argv.includes("--local");
const dryRun = process.argv.includes("--dry-run");
const root = path.resolve(import.meta.dirname, "..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

function isPublished(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const packages = readdirSync(path.join(root, "packages"))
  .map((dir) => path.join(root, "packages", dir))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) }))
  .filter(({ pkg }) => !pkg.private);

const out = mkdtempSync(path.join(tmpdir(), "quickben-pack-"));
let published = 0;
try {
  for (const { dir, pkg } of packages) {
    if (pkg.version === "0.0.0") {
      console.log(`skip ${pkg.name}: version 0.0.0 (run changeset version first)`);
      continue;
    }
    if (isPublished(pkg.name, pkg.version)) {
      console.log(`skip ${pkg.name}@${pkg.version}: already on npm`);
      continue;
    }
    const before = new Set(readdirSync(out));
    run("pnpm", ["pack", "--pack-destination", out], { cwd: dir });
    const tarball = readdirSync(out).find((f) => !before.has(f));
    const args = ["publish", path.join(out, tarball), "--access", "public"];
    // package.json sets publishConfig.provenance, which npm can only honor in CI.
    args.push(local ? "--provenance=false" : "--provenance");
    if (dryRun) args.push("--dry-run");
    run("npm", args);
    published += 1;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`${published} package(s) published${dryRun ? " (dry run)" : ""}.`);
