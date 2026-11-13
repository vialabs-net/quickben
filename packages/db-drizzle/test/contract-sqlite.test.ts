import { runAdapterContractTests } from "@quickben/adapter-tests";
import { afterEach, expect, it } from "vitest";

import { drizzleAdapter } from "./drizzle";

import type { DrizzleAdapter } from "../src";

let current: DrizzleAdapter | undefined;

afterEach(async () => {
  await current?.close?.();
  current = undefined;
});

runAdapterContractTests(() => {
  current = drizzleAdapter({ dialect: "sqlite" });
  return current;
});

it("is a sqlite Drizzle adapter", () => {
  const db = drizzleAdapter({ dialect: "sqlite" });
  expect([db.name, db.dialect]).toEqual(["drizzle", "sqlite"]);
});
