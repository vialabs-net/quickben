import { runAdapterContractTests } from "@quickben/adapter-tests";
import { afterEach, expect, it } from "vitest";

import { drizzleAdapter } from "../src";

import type { DrizzleAdapter } from "../src";

let current: DrizzleAdapter | undefined;

afterEach(async () => {
  await current?.close?.();
  current = undefined;
});

runAdapterContractTests(() => {
  current = drizzleAdapter({ dialect: "pglite" });
  return current;
});

it("is a pglite Drizzle adapter", () => {
  const db = drizzleAdapter({ dialect: "pglite" });
  expect([db.name, db.dialect]).toEqual(["drizzle", "pglite"]);
});
