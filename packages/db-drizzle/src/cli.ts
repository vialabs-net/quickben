import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createJiti } from "jiti";

import { generateDrizzleSchema, resolveTarget, schemaOf, writeOut } from "./generate";
import { generateSql, sqlScript } from "./sql";

import type { DrizzleAdapter } from "./adapter";
import type { Dialect } from "./columns";
import type { SchemaReport } from "./inspect";
import type { QuickbenConfig } from "@quickben/core";

const usage = `Usage: quickben-drizzle <command> [options]

Commands:
  generate   Write a Drizzle schema file, for drizzle-kit
  sql        Print SQL DDL (or Prisma models) for every collection
  verify     Check that a database has every table, column and index (exit 1 if not)

Options:
  --config <path>    Quickben config (default: quickben.config.ts)
  --dialect <name>   postgres, pglite or sqlite (default: from the config's drizzleAdapter)
  --schema <name>    Postgres schema of the tables (default: from the config's drizzleAdapter)
  --out <path>       File to write (generate default: drizzle/schema.ts; sql default: stdout)
  --format <name>    sql: sql (default) or prisma
  --diff             sql: print only the statements the database at --url is missing
  --url <url>        sql --diff, verify: database URL (PGlite: the data directory)
  -h, --help         Show this help`;

const dialects = new Set(["postgres", "pglite", "sqlite"]);
const commands = new Set(["generate", "sql", "verify"]);

type Values = Partial<
  Record<"config" | "out" | "dialect" | "schema" | "format" | "url", string>
> & {
  diff?: boolean;
};

/** Open the database at `url` with the adapter of the dialect, and compare. */
async function checkDatabase(
  config: QuickbenConfig,
  target: { dialect: Dialect; schema: string | undefined },
  url: string,
): Promise<SchemaReport> {
  const common = { push: false, verify: false } as const;
  const schema = target.schema === undefined ? {} : { schema: target.schema };
  let adapter: DrizzleAdapter;
  if (target.dialect === "postgres") {
    const { drizzleAdapter } = await import("./postgres");
    adapter = drizzleAdapter({ ...common, ...schema, url });
  } else if (target.dialect === "pglite") {
    const { drizzleAdapter } = await import("./pglite");
    adapter = drizzleAdapter({ ...common, ...schema, dataDir: url });
  } else {
    const { drizzleAdapter } = await import("./sqlite");
    adapter = drizzleAdapter({ ...common, url });
  }
  try {
    await adapter.init(schemaOf(config));
    return await adapter.checkSchema();
  } finally {
    await adapter.close?.();
  }
}

async function runSql(config: QuickbenConfig, values: Values, cwd: string): Promise<number> {
  const out = values.out === undefined ? undefined : resolve(cwd, values.out);
  const options = {
    ...(values.dialect ? { dialect: values.dialect as Dialect } : {}),
    ...(values.schema ? { schema: values.schema } : {}),
  };
  if (!values.diff) {
    const format = values.format === "prisma" ? "prisma" : "sql";
    const source = await generateSql(config, { ...options, format, ...(out ? { out } : {}) });
    if (out) console.error(`Wrote ${out}`);
    else process.stdout.write(source);
    return 0;
  }
  return runDiff(config, resolveTarget("sql", config, options), values.url, out);
}

async function runDiff(
  config: QuickbenConfig,
  target: { dialect: Dialect; schema: string | undefined },
  url: string | undefined,
  out: string | undefined,
): Promise<number> {
  if (!url) {
    console.error("sql --diff needs --url.");
    return 1;
  }
  const report = await checkDatabase(config, target, url);
  const fixable = new Set(["missing-table", "missing-column", "unique", "index"]);
  for (const issue of report.issues) {
    if (!fixable.has(issue.problem)) console.error(`Not fixed by this SQL: ${issue.message}`);
  }
  const source = report.statements.length === 0 ? "" : sqlScript(report.statements);
  if (out) {
    await writeOut(out, source);
    console.error(`Wrote ${out} (${String(report.statements.length)} statements)`);
  } else if (source) {
    process.stdout.write(source);
  } else {
    console.error("Nothing is missing.");
  }
  return 0;
}

async function runVerify(config: QuickbenConfig, values: Values): Promise<number> {
  if (!values.url) {
    console.error("verify needs --url.");
    return 1;
  }
  const target = resolveTarget("verify", config, {
    ...(values.dialect ? { dialect: values.dialect as Dialect } : {}),
    ...(values.schema ? { schema: values.schema } : {}),
  });
  const { issues } = await checkDatabase(config, target, values.url);
  const tables = String(config.collections.length);
  if (issues.length === 0) {
    console.error(`The database matches the collections (${tables} tables).`);
    return 0;
  }
  for (const issue of issues) console.error(`- ${issue.message}`);
  console.error(
    `${String(issues.length)} issues. Run \`quickben-drizzle sql --diff\` for the SQL.`,
  );
  return 1;
}

function badInput(values: Values): string | undefined {
  if (values.dialect !== undefined && !dialects.has(values.dialect)) {
    return `Unknown dialect "${values.dialect}". Use postgres, pglite or sqlite.`;
  }
  if (values.format !== undefined && values.format !== "sql" && values.format !== "prisma") {
    return `Unknown format "${values.format}". Use sql or prisma.`;
  }
  if (values.diff && values.format === "prisma") return "--diff prints SQL only.";
  return undefined;
}

/** Run the CLI. Returns the exit code. */
export async function main(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      config: { type: "string", default: "quickben.config.ts" },
      out: { type: "string" },
      dialect: { type: "string" },
      schema: { type: "string" },
      format: { type: "string" },
      diff: { type: "boolean" },
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || command === undefined || !commands.has(command)) {
    console.error(usage);
    return values.help ? 0 : 1;
  }
  const error = badInput(values);
  if (error) {
    console.error(error);
    return 1;
  }
  const jiti = createJiti(import.meta.url);
  const config = await jiti.import<QuickbenConfig>(resolve(cwd, values.config), {
    default: true,
  });
  if (command === "sql") return runSql(config, values, cwd);
  if (command === "verify") return runVerify(config, values);
  const out = resolve(cwd, values.out ?? "drizzle/schema.ts");
  const source = await generateDrizzleSchema(config, {
    out,
    ...(values.dialect ? { dialect: values.dialect as Dialect } : {}),
    ...(values.schema ? { schema: values.schema } : {}),
  });
  const tables = source.match(/^export const \w+Table /gm)?.length ?? 0;
  console.error(`Wrote ${out} (${String(tables)} tables)`);
  return 0;
}
