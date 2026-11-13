import { defineConfig } from "tsdown";

export default defineConfig({
  // One output file per source file, so "use client" stays at the top of client modules.
  entry: ["src/index.ts", "src/client/index.ts", "src/admin/index.ts"],
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
