import { describe, expect, it } from "vitest";

import { detectPackageManager, installCommand, runPrefix, runScript } from "../src/pm";

describe("detectPackageManager", () => {
  it.each([
    ["pnpm/12.18.0 npm/? node/v24.14.0 darwin arm64", "pnpm"],
    ["yarn/4.9.0 npm/? node/v22.18.0 linux x64", "yarn"],
    ["bun/1.3.0 npm/? node/v24.3.0 linux x64", "bun"],
    ["npm/11.6.0 node/v24.14.0 darwin arm64 workspaces/false", "npm"],
    ["deno/2.5.0", "npm"],
    [undefined, "npm"],
  ])("%s → %s", (agent, pm) => {
    expect(detectPackageManager(agent)).toBe(pm);
  });
});

describe("commands", () => {
  it("installs with `<pm> install`", () => {
    expect(installCommand("bun")).toEqual({ command: "bun", args: ["install"] });
  });

  it.each([
    ["pnpm", "pnpm dev"],
    ["yarn", "yarn dev"],
    ["npm", "npm run dev"],
    ["bun", "bun run dev"],
  ] as const)("runs scripts with %s", (pm, command) => {
    expect(runScript(pm, "dev")).toBe(command);
    expect(command.startsWith(runPrefix(pm))).toBe(true);
  });
});
