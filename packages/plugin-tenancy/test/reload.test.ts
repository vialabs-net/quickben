import { createQuickben } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";


import { getTenancy } from "../src/options";

import { makeConfig } from "./setup";

describe("dev hot reload", () => {
  it("finds the plugin state after its module is loaded again", async () => {
    const qb = await createQuickben(makeConfig());
    const before = getTenancy(qb);
    vi.resetModules();
    const reloaded = await import("../src/options");
    expect(reloaded.getTenancy).not.toBe(getTenancy);
    expect(reloaded.getTenancy(qb)).toBe(before);
  });
});
