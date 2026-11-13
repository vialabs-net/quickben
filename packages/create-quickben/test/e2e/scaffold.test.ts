/**
 * Scaffold pglite + blank with the built CLI, install the @quickben/* packages from local
 * tarballs (`pnpm pack`), run `next build`, then `next start` and request a few pages.
 *
 * Run: `pnpm turbo run build --filter=./packages/*` then `pnpm --filter create-quickben test:e2e`.
 * Set `QUICKBEN_E2E_KEEP=1` to keep the temp directory.
 */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "../..");
const packagesDir = resolve(packageDir, "..");
const quickbenPackages = ["core", "next", "admin", "db-drizzle", "db-memory"];

let work: string;
let app: string;

/** Run pnpm the way the test was started (`npm_execpath`: a script or a binary), else from PATH. */
function pnpm(args: string[], cwd: string) {
  const execPath = process.env.npm_execpath;
  if (!execPath?.includes("pnpm")) return exec("pnpm", args, { cwd });
  return /\.[cm]?js$/.test(execPath)
    ? exec(process.execPath, [execPath, ...args], { cwd })
    : exec(execPath, args, { cwd });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolvePort(address.port);
        else reject(new Error("No port"));
      });
    });
  });
}

async function waitFor(url: string, timeout = 60_000): Promise<Response> {
  const start = Date.now();
  for (;;) {
    try {
      return await fetch(url);
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "create-quickben-e2e-"));
  const packs = join(work, "packs");
  for (const name of quickbenPackages) {
    await pnpm(["pack", "--pack-destination", packs], join(packagesDir, name));
  }
  const tarballs = await readdir(packs);

  await exec(
    process.execPath,
    [
      join(packageDir, "dist/bin.js"),
      "app",
      "--db",
      "pglite",
      "--example",
      "blank",
      "--no-install",
      "--no-git",
      "--yes",
    ],
    { cwd: work },
  );
  app = join(work, "app");

  // Install @quickben/* from the tarballs instead of the registry.
  const manifestPath = join(app, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const local: Record<string, string> = {};
  for (const name of Object.keys(manifest.dependencies).filter((n) => n.startsWith("@quickben/"))) {
    const file = tarballs.find((t) => t.startsWith(`${name.slice(1).replace("/", "-")}-`));
    if (!file) throw new Error(`No tarball for ${name}`);
    local[name] = `file:${join(packs, file)}`;
  }
  Object.assign(manifest.dependencies, local);
  manifest.overrides = local;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  await exec("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: app });
});

afterAll(async () => {
  if (work && !process.env.QUICKBEN_E2E_KEEP) await rm(work, { recursive: true, force: true });
});

it("builds with next build and serves the home page, admin and API", async () => {
  const next = join(app, "node_modules/next/dist/bin/next");
  const build = await exec(process.execPath, [next, "build"], { cwd: app });
  expect(build.stdout).toContain("/admin/[[...segments]]");
  expect(build.stdout).toContain("/api/[...quickben]");

  const port = await freePort();
  const server = spawn(process.execPath, [next, "start", "--port", String(port)], {
    cwd: app,
    stdio: "ignore",
  });
  try {
    const home = await waitFor(`http://localhost:${port}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("No notes yet");

    const api = await fetch(`http://localhost:${port}/api/notes`);
    expect(api.status).toBe(200);
    expect(await api.json()).toMatchObject({ docs: [] });

    const admin = await fetch(`http://localhost:${port}/admin`);
    expect(admin.status).toBe(200);
  } finally {
    server.kill();
  }
});
