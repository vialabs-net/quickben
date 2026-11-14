import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  // Server only: `node:` modules stay imports.
  deps: { neverBundle: [/^node:/] },
  target: "es2023",
  dts: true,
  sourcemap: true,
  clean: true,
  publint: true,
});
