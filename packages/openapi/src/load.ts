import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { isObject } from "./schemas";

import type { OpenApiOptions } from "./types";
import type { QuickbenConfig } from "@quickben/core";

type ModuleRecord = Record<string, unknown>;

interface TsxApi {
  tsImport: (specifier: string, parent: string) => Promise<unknown>;
}

function isTsxApi(value: unknown): value is TsxApi {
  return isObject(value) && typeof value.tsImport === "function";
}

/** `tsx/esm/api` installed next to the config file, if any. */
async function loadTsx(file: string): Promise<TsxApi | undefined> {
  let resolved: string;
  try {
    resolved = createRequire(file).resolve("tsx/esm/api");
  } catch {
    return undefined;
  }
  const loaded = (await import(pathToFileURL(resolved).href)) as ModuleRecord;
  if (isTsxApi(loaded)) return loaded;
  return isTsxApi(loaded.default) ? loaded.default : undefined;
}

/**
 * Import a module. TypeScript files go through `tsx` when the app has it installed (path
 * aliases and extensionless imports work); otherwise Node's own type stripping is used.
 */
export async function importModule(file: string): Promise<ModuleRecord> {
  const url = pathToFileURL(file).href;
  if (/\.[cm]?tsx?$/.test(file)) {
    const tsx = await loadTsx(file);
    if (tsx) return (await tsx.tsImport(url, url)) as ModuleRecord;
  }
  return (await import(url)) as ModuleRecord;
}

function isConfig(value: unknown): value is QuickbenConfig {
  return isObject(value) && Array.isArray(value.collections) && isObject(value.admin);
}

/** What a config module gives the CLI. */
export interface LoadedConfig {
  config: QuickbenConfig;
  /** The module's `openapi` export: options of `generateOpenApi`. */
  options: OpenApiOptions;
}

/**
 * Find the config in a module: the default export or a `config` export (a `defineConfig`
 * result). An `openapi` export, when present, holds the generator options.
 */
export function configFromModule(module: ModuleRecord, file: string): LoadedConfig {
  const candidates = [
    module.default,
    module.config,
    isObject(module.default) ? module.default.default : undefined,
  ];
  const config = candidates.find(isConfig);
  if (!config) {
    throw new Error(`${file} has no Quickben config: export default defineConfig({ … })`);
  }
  const options = isObject(module.openapi) ? (module.openapi as OpenApiOptions) : {};
  return { config, options };
}
