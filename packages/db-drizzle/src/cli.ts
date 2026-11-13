import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createJiti } from "jiti";

import { generateDrizzleSchema } from "./generate";

import type { Dialect } from "./columns";
import type { QuickbenConfig } from "@quickben/core";

const usage = `Usage: quickben-drizzle generate [options]

Write a Drizzle schema file from your Quickben config, for drizzle-kit.

Options:
  --config <path>    Quickben config (default: quickben.config.ts)
  --out <path>       Schema file to write (default: drizzle/schema.ts)
  --dialect <name>   postgres, pglite or sqlite (default: from the config's drizzleAdapter)
  -h, --help         Show this help`;

const dialects = new Set(["postgres", "pglite", "sqlite"]);

/** Run the CLI. Returns the exit code. */
export async function main(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      config: { type: "string", default: "quickben.config.ts" },
      out: { type: "string", default: "drizzle/schema.ts" },
      dialect: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals[0] !== "generate") {
    console.error(usage);
    return values.help ? 0 : 1;
  }
  if (values.dialect !== undefined && !dialects.has(values.dialect)) {
    console.error(`Unknown dialect "${values.dialect}". Use postgres, pglite or sqlite.`);
    return 1;
  }
  const configPath = resolve(cwd, values.config);
  const out = resolve(cwd, values.out);
  const jiti = createJiti(import.meta.url);
  const config = await jiti.import<QuickbenConfig>(configPath, { default: true });
  const source = await generateDrizzleSchema(config, {
    out,
    ...(values.dialect ? { dialect: values.dialect as Dialect } : {}),
  });
  const tables = source.match(/^export const /gm)?.length ?? 0;
  console.error(`Wrote ${out} (${tables} tables)`);
  return 0;
}
