import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // One entry per dialect, so a bundler only resolves the driver the app imports.
    entry: ["src/index.ts", "src/postgres.ts", "src/pglite.ts", "src/sqlite.ts"],
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
