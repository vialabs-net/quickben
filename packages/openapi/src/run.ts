import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { diffOpenApi, formatDiff } from "./diff";
import { generateOpenApi, stringifyOpenApi } from "./generate";
import { configFromModule, importModule } from "./load";

import type { OpenApiOptions } from "./types";

/** Where the CLI writes and how it loads modules. Tests replace it. */
export interface CliIo {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  importModule?: (file: string) => Promise<Record<string, unknown>>;
}

const usage = `Usage:
  quickben-openapi generate --config <file> [--out <file>] [--check]
                            [--title <text>] [--api-version <v>] [--server <url>]… [--base-path <path>]
  quickben-openapi diff <base.json> <head.json> [--json]

generate  Write the OpenAPI document of a config. --check compares it with --out instead and
          fails when the file is stale.
diff      Classify changes as breaking or not. Exits 1 on breaking changes.
`;

class UsageError extends Error {}

function generatorOptions(values: Record<string, unknown>, base: OpenApiOptions): OpenApiOptions {
  const options: OpenApiOptions = { ...base };
  const info = { ...base.info };
  if (typeof values.title === "string") info.title = values.title;
  if (typeof values["api-version"] === "string") info.version = values["api-version"];
  if (Object.keys(info).length > 0) options.info = info;
  const servers = values.server;
  if (Array.isArray(servers) && servers.length > 0) {
    options.servers = servers.map((url) => ({ url: String(url) }));
  }
  if (typeof values["base-path"] === "string") options.basePath = values["base-path"];
  return options;
}

async function generate(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      check: { type: "boolean" },
      title: { type: "string" },
      "api-version": { type: "string" },
      server: { type: "string", multiple: true },
      "base-path": { type: "string" },
    },
  });
  if (values.config === undefined) throw new UsageError("generate needs --config <file>");
  if (values.check === true && values.out === undefined) {
    throw new UsageError("--check needs --out <file>");
  }
  const file = resolve(io.cwd, values.config);
  const loaded = configFromModule(await (io.importModule ?? importModule)(file), values.config);
  const text = stringifyOpenApi(
    generateOpenApi(loaded.config, generatorOptions(values, loaded.options)),
  );
  if (values.out === undefined) {
    io.stdout(text);
    return 0;
  }
  const out = resolve(io.cwd, values.out);
  if (values.check === true) {
    const current = await readFile(out, "utf8").catch(() => undefined);
    if (current === text) {
      io.stdout(`${values.out} is up to date.\n`);
      return 0;
    }
    io.stderr(
      `${values.out} is stale. Run: quickben-openapi generate --config ${values.config} --out ${values.out}\n`,
    );
    return 1;
  }
  await writeFile(out, text);
  io.stdout(`Wrote ${values.out}.\n`);
  return 0;
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
}

async function diff(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const [baseFile, headFile, ...rest] = positionals;
  if (baseFile === undefined || headFile === undefined || rest.length > 0) {
    throw new UsageError("diff needs <base.json> <head.json>");
  }
  const result = diffOpenApi(
    await readJson(resolve(io.cwd, baseFile)),
    await readJson(resolve(io.cwd, headFile)),
  );
  io.stdout(values.json === true ? `${JSON.stringify(result, null, 2)}\n` : formatDiff(result));
  return result.breaking > 0 ? 1 : 0;
}

/**
 * Run the `quickben-openapi` CLI. Resolves the exit code: `0` success, `1` stale document or
 * breaking changes, `2` usage or input error.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === "generate") return await generate(args, io);
    if (command === "diff") return await diff(args, io);
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.stdout(usage);
      return command === undefined ? 2 : 0;
    }
    throw new UsageError(`Unknown command "${command}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`quickben-openapi: ${message}\n`);
    if (error instanceof UsageError) io.stderr(`\n${usage}`);
    return 2;
  }
}
