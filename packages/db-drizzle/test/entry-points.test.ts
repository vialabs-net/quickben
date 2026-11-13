import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "../src");
const drivers = ["pg", "@electric-sql/pglite", "@libsql/client"];

/** Every bare specifier reachable from `entry` through relative imports, static or dynamic. */
function reachableImports(entry: string, seen = new Set<string>()): Set<string> {
  const found = new Set<string>();
  if (seen.has(entry)) return found;
  seen.add(entry);
  const source = readFileSync(entry, "utf8");
  for (const [, specifier] of source.matchAll(/(?:from|import\()\s*"([^"]+)"/g)) {
    if (specifier === undefined) continue;
    if (specifier.startsWith(".")) {
      const next = join(dirname(entry), `${specifier}.ts`);
      for (const nested of reachableImports(next, seen)) found.add(nested);
    } else {
      found.add(specifier);
    }
  }
  return found;
}

const driverImports = (entry: string) =>
  [...reachableImports(join(src, entry))].filter(
    (specifier) =>
      drivers.includes(specifier) ||
      /^drizzle-orm\/(?:node-postgres|pglite|libsql)$/.test(specifier),
  );

// Bundlers resolve every import they see, also dynamic ones. An entry point that reaches the
// driver of another dialect breaks apps that did not install that driver.
describe("entry points", () => {
  it("the main entry loads no driver", () => {
    expect(driverImports("index.ts")).toEqual([]);
  });

  it.each([
    ["postgres.ts", ["drizzle-orm/node-postgres", "pg"]],
    ["pglite.ts", ["drizzle-orm/pglite", "@electric-sql/pglite"]],
    ["sqlite.ts", ["drizzle-orm/libsql", "@libsql/client"]],
  ])("%s loads only its own driver", (entry, expected) => {
    expect(new Set(driverImports(entry))).toEqual(new Set(expected));
  });
});
