import { describe, expect, it, vi } from "vitest";

import { getTemplatesPlugin } from "../src/options";

import { setup } from "./fixtures";

describe("dev hot reload", () => {
  it("finds the plugin state after its module is loaded again", async () => {
    const qb = await setup();
    const before = getTemplatesPlugin(qb);
    vi.resetModules();
    const reloaded = await import("../src/options");
    expect(reloaded.getTemplatesPlugin).not.toBe(getTemplatesPlugin);
    expect(reloaded.getTemplatesPlugin(qb)).toBe(before);
  });
});
