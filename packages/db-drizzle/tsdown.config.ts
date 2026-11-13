import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: "esm",
    platform: "neutral",
    target: "es2023",
    // Drivers and `node:` modules are loaded with dynamic imports when needed.
    deps: { neverBundle: [/^node:/] },
    dts: true,
    sourcemap: true,
    clean: true,
    publint: true,
  },
  {
    entry: ["src/bin.ts"],
    format: "esm",
    platform: "node",
    target: "es2023",
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
  },
]);
