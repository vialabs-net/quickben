import { join } from "node:path";

import { defineConfig } from "tsdown";

// tsdown loads this file with Node, which needs the .ts extension.
import { stampTemplates, workspaceVersions } from "./src/stamp.ts";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  platform: "node",
  target: "es2023",
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: true,
  publint: true,
  hooks: {
    // Copy the templates next to bin.js with `workspace:` versions replaced by the current
    // package versions, so the published CLI installs matching @quickben/* packages.
    "build:done": async () => {
      const root = import.meta.dirname;
      await stampTemplates(
        join(root, "templates"),
        join(root, "dist/templates"),
        await workspaceVersions(join(root, "..")),
      );
    },
  },
});
