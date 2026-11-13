import { defineConfig } from "tsdown";

export default defineConfig({
  // One output file per source file: the admin entry has "use client" and "use server"
  // modules, and both entries must share one copy of the plugin state.
  entry: ["src/index.ts", "src/admin/index.ts"],
  unbundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: true,
  clean: true,
  // Directives are kept by `unbundle`; the warning does not apply.
  inputOptions: { checks: { moduleLevelDirective: false } },
  publint: true,
});
