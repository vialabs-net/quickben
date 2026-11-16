import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: "esm",
  platform: "node",
  // `node:` modules stay imports.
  deps: { neverBundle: [/^node:/] },
  target: "es2023",
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: true,
  publint: true,
});
