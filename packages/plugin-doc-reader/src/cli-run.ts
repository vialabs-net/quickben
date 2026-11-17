/**
 * The `quickben-doc-reader` command: import, split, run and export from a terminal, against the
 * database of a Quickben config. It runs as trusted server code.
 */
import { lstat, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { getQuickben } from "@quickben/core";

import { exportTestRun, getTestRun, startTestRun } from "./bench";
import { SPLITS } from "./collections";
import { importSamples } from "./import";
import { loadFolder, loadManifest } from "./node";
import { getDocReader } from "./options";
import { rescoreTestRun } from "./rescore";
import { splitSamples } from "./splits";

import type { Split } from "./collections";
import type { ExpectedMapper } from "./import";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

type ModuleRecord = Record<string, unknown>;

/** Where the CLI writes and how it loads modules. Tests replace it. */
export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly importModule?: (file: string) => Promise<ModuleRecord>;
  /** Poll interval of `run --wait`. Default 2000 ms. */
  readonly pollMs?: number;
}

export const usage = `Usage: quickben-doc-reader <command> --config <file> --type <key> [options]

Commands:
  import   Add or update samples from --manifest <file.jsonl|json> or --dir <folder>
           [--map <module>] (default export: (expected, item) => values by field) [--dry-run]
  split    Split the samples [--seed <text>] [--ratios 60/20/20] [--stratify group,attr]
           [--unseen <group,group>] [--resplit] [--note <text>]
  run      Test a version --version <n> [--split dev,validation] [--held-out]
           [--concurrency <n>] [--max-cost <usd>] [--retries <n>] [--wait]
  export   Write a run --run <id> [--format csv|json] [--out <file>]
  rescore  Score a run again with today's expected values and rules, without reading
           --run <id> [--version <n>] (default: the run's version)

The command runs as trusted server code against the config's database.`;

export class UsageError extends Error {}

const CLI_CONTEXT: RequestContext = {
  user: { id: "cli", email: "cli" },
  overrideAccess: true,
};

/** `tsx/esm/api` installed next to the file, if any. */
async function loadTsx(
  file: string,
): Promise<{ tsImport: (specifier: string, parent: string) => Promise<unknown> } | undefined> {
  let resolved: string;
  try {
    resolved = createRequire(file).resolve("tsx/esm/api");
  } catch {
    return undefined;
  }
  const loaded = (await import(pathToFileURL(resolved).href)) as ModuleRecord;
  const api = (typeof loaded.tsImport === "function" ? loaded : loaded.default) as
    { tsImport?: unknown } | undefined;
  return typeof api?.tsImport === "function"
    ? (api as { tsImport: (specifier: string, parent: string) => Promise<unknown> })
    : undefined;
}

/** Import a module; TypeScript through `tsx` when the app has it, else Node's type stripping. */
export async function importModule(file: string): Promise<ModuleRecord> {
  const url = pathToFileURL(file).href;
  if (/\.[cm]?tsx?$/u.test(file)) {
    const tsx = await loadTsx(file);
    if (tsx) return (await tsx.tsImport(url, url)) as ModuleRecord;
  }
  return (await import(url)) as ModuleRecord;
}

const isObject = (value: unknown): value is ModuleRecord =>
  typeof value === "object" && value !== null;

function configOf(module: ModuleRecord, file: string): QuickbenConfig {
  const candidates = [
    module.default,
    module.config,
    isObject(module.default) ? module.default.default : undefined,
  ];
  const config = candidates.find(
    (value): value is QuickbenConfig => isObject(value) && Array.isArray(value.collections),
  );
  if (!config) throw new UsageError(`${file} has no Quickben config`);
  return config;
}

function splitsOf(text: string | undefined): Split[] | undefined {
  if (text === undefined) return undefined;
  const list = text.split(",").map((part) => part.trim());
  for (const split of list) {
    if (!(SPLITS as readonly string[]).includes(split))
      throw new UsageError(`Unknown split ${split}: use ${SPLITS.join(", ")}`);
  }
  return list as Split[];
}

function numberOf(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new UsageError(`--${name} is a number`);
  return value;
}

function ratiosOf(text: string | undefined) {
  if (text === undefined) return undefined;
  const parts = text.split("/").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new UsageError("--ratios is dev/validation/test, e.g. 60/20/20");
  }
  const [dev = 0, validation = 0, test = 0] = parts;
  const total = dev + validation + test;
  if (total <= 0) throw new UsageError("--ratios needs one part above 0");
  return { dev: dev / total, validation: validation / total, test: test / total };
}

const list = (text: string | undefined) =>
  text === undefined
    ? undefined
    : text
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

const options = {
  config: { type: "string" },
  type: { type: "string" },
  manifest: { type: "string" },
  dir: { type: "string" },
  map: { type: "string" },
  "dry-run": { type: "boolean" },
  seed: { type: "string" },
  ratios: { type: "string" },
  stratify: { type: "string" },
  unseen: { type: "string" },
  resplit: { type: "boolean" },
  note: { type: "string" },
  version: { type: "string" },
  split: { type: "string" },
  "held-out": { type: "boolean" },
  concurrency: { type: "string" },
  "max-cost": { type: "string" },
  retries: { type: "string" },
  wait: { type: "boolean" },
  run: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof options; allowPositionals: true }>
>["values"];

async function mapperOf(io: CliIo, path: string | undefined): Promise<ExpectedMapper | undefined> {
  if (path === undefined) return undefined;
  const module = await (io.importModule ?? importModule)(resolve(io.cwd, path));
  const map = module.default ?? module.map;
  if (typeof map !== "function") throw new UsageError(`${path} has no default export function`);
  return map as ExpectedMapper;
}

async function runImport(qb: Quickben, type: string, values: Values, io: CliIo): Promise<number> {
  if ((values.manifest === undefined) === (values.dir === undefined)) {
    throw new UsageError("import needs --manifest <file> or --dir <folder>");
  }
  const items =
    values.manifest === undefined
      ? loadFolder(resolve(io.cwd, values.dir ?? "."))
      : loadManifest(resolve(io.cwd, values.manifest));
  const map = await mapperOf(io, values.map);
  const report = await importSamples(qb, CLI_CONTEXT, type, items, {
    ...(map ? { map } : {}),
    ...(values["dry-run"] ? { dryRun: true } : {}),
    onProgress: ({ done }) => {
      if (done % 100 === 0) io.stderr(`${String(done)} samples\n`);
    },
  });
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  return report.failed.length > 0 ? 1 : 0;
}

async function runSplit(qb: Quickben, type: string, values: Values, io: CliIo): Promise<number> {
  const ratios = ratiosOf(values.ratios);
  const stratifyBy = list(values.stratify);
  const unseenGroups = list(values.unseen);
  const split = await splitSamples(qb, CLI_CONTEXT, type, {
    ...(values.seed ? { seed: values.seed } : {}),
    ...(ratios ? { ratios } : {}),
    ...(stratifyBy ? { stratifyBy } : {}),
    ...(unseenGroups ? { unseenGroups } : {}),
    ...(values.note ? { note: values.note } : {}),
    ...(values.resplit ? { resplit: true } : {}),
  });
  io.stdout(`${JSON.stringify(split, null, 2)}\n`);
  return 0;
}

async function runRun(qb: Quickben, type: string, values: Values, io: CliIo): Promise<number> {
  const version = numberOf(values.version, "version");
  if (version === undefined) throw new UsageError("run needs --version <n>");
  const split = splitsOf(values.split);
  const concurrency = numberOf(values.concurrency, "concurrency");
  const maxCostUsd = numberOf(values["max-cost"], "max-cost");
  const retries = numberOf(values.retries, "retries");
  const [run] = await startTestRun(qb, CLI_CONTEXT, type, version, {
    ...(split ? { split } : {}),
    ...(values["held-out"] ? { heldOut: true } : {}),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(retries === undefined ? {} : { retries }),
  });
  if (!run) return 1;
  io.stderr(`Run ${run.id}: ${String(run.total)} samples\n`);
  if (!values.wait && !getDocReader(qb).runner.inProcess) {
    io.stdout(`${run.id}\n`);
    return 0;
  }
  let current = await getTestRun(qb, CLI_CONTEXT, run.id);
  while (current.state === "running") {
    await new Promise((done) => setTimeout(done, io.pollMs ?? 2000));
    current = await getTestRun(qb, CLI_CONTEXT, run.id);
    io.stderr(`${String(current.results.length)}/${String(current.total)}\n`);
  }
  if (!values.wait) {
    io.stdout(`${run.id}\n`);
    return current.state === "done" ? 0 : 1;
  }
  io.stdout(
    `${JSON.stringify({ id: current.id, state: current.state, summary: current.summary, metrics: current.metrics }, null, 2)}\n`,
  );
  return current.state === "done" ? 0 : 1;
}

async function runExport(qb: Quickben, values: Values, io: CliIo): Promise<number> {
  if (values.run === undefined) throw new UsageError("export needs --run <id>");
  const format = values.format ?? "csv";
  if (format !== "csv" && format !== "json") throw new UsageError("--format is csv or json");
  const text = await exportTestRun(qb, CLI_CONTEXT, values.run, format);
  if (values.out === undefined) io.stdout(text);
  else {
    const base = await realpath(io.cwd);
    const requested = resolve(base, values.out);
    const target = await realpath(requested).catch(async (error: unknown) => {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      // realpath also reports ENOENT for a dangling symlink. Never follow one on write.
      const entry = await lstat(requested).catch((missing: unknown) => {
        if (!(missing instanceof Error) || !("code" in missing) || missing.code !== "ENOENT") {
          throw missing;
        }
        return null;
      });
      if (entry?.isSymbolicLink()) {
        throw new UsageError("--out must be inside the working directory");
      }
      return join(await realpath(dirname(requested)), basename(requested));
    });
    if (!target.startsWith(base.endsWith(sep) ? base : base + sep)) {
      throw new UsageError("--out must be inside the working directory");
    }
    await writeFile(target, text);
    io.stderr(`Wrote ${values.out}\n`);
  }
  return 0;
}

async function runRescore(qb: Quickben, values: Values, io: CliIo): Promise<number> {
  if (values.run === undefined) throw new UsageError("rescore needs --run <id>");
  const version = values.version === undefined ? undefined : Number(values.version);
  if (version !== undefined && !Number.isInteger(version)) {
    throw new UsageError("--version is a number");
  }
  const run = await rescoreTestRun(
    qb,
    CLI_CONTEXT,
    values.run,
    version === undefined ? {} : { version },
  );
  io.stdout(
    `${JSON.stringify({ id: run.id, rescoredFrom: run.rescoredFrom, version: run.typeVersion, summary: run.summary }, null, 2)}\n`,
  );
  return 0;
}

async function dispatch(command: string, values: Values, io: CliIo): Promise<number> {
  if (values.config === undefined) throw new UsageError("--config <file> is required");
  const file = resolve(io.cwd, values.config);
  const config = configOf(await (io.importModule ?? importModule)(file), values.config);
  const qb = await getQuickben(config);
  try {
    if (command === "export") return await runExport(qb, values, io);
    if (command === "rescore") return await runRescore(qb, values, io);
    if (values.type === undefined) throw new UsageError("--type <key> is required");
    if (command === "import") return await runImport(qb, values.type, values, io);
    if (command === "split") return await runSplit(qb, values.type, values, io);
    return await runRun(qb, values.type, values, io);
  } finally {
    await getDocReader(qb).runner.close?.();
    await qb.config.db.close?.();
  }
}

/** Run the CLI. Returns the exit code. */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: [...args], options, allowPositionals: true });
    const [command] = positionals;
    if (values.help || command === undefined) {
      io.stdout(`${usage}\n`);
      return command === undefined && !values.help ? 1 : 0;
    }
    if (!["import", "split", "run", "export", "rescore"].includes(command)) {
      throw new UsageError(`Unknown command ${command}`);
    }
    return await dispatch(command, values, io);
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && "code" in error)) {
      io.stderr(`${error.message}\n\n${usage}\n`);
      return 2;
    }
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
