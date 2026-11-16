import { describe, expect, it, vi } from "vitest";

import { getDocReader } from "../src/options";

import { setup } from "./helpers";

describe("dev hot reload", () => {
  it("finds the plugin state after its module is loaded again", async () => {
    const qb = (await setup()).qb;
    const before = getDocReader(qb);
    vi.resetModules();
    const reloaded = await import("../src/options");
    expect(reloaded.getDocReader).not.toBe(getDocReader);
    expect(reloaded.getDocReader(qb)).toBe(before);
  });
});
