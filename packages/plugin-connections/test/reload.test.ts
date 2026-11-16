import { describe, expect, it, vi } from "vitest";

import { getConnectionsOptions } from "../src/options";

import { setup } from "./setup";

describe("dev hot reload", () => {
  it("finds the plugin state after its module is loaded again", async () => {
    const qb = (await setup()).qb;
    const before = getConnectionsOptions(qb);
    vi.resetModules();
    const reloaded = await import("../src/options");
    expect(reloaded.getConnectionsOptions).not.toBe(getConnectionsOptions);
    expect(reloaded.getConnectionsOptions(qb)).toBe(before);
  });

  it("finds an admin instance after the registry module is loaded again", async () => {
    const { config } = await setup();
    const registry = await import("../src/admin/registry");
    const key = registry.registerConnectionsAdmin({ config, basePath: "/admin" });
    vi.resetModules();
    const reloaded = await import("../src/admin/registry");
    expect(reloaded.getConnectionsAdmin(key)?.config).toBe(config);
  });
});
