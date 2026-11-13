import { defineConfig } from "tsdown";

export default defineConfig({
  // One output file per source file: the admin entry has "use client" and "use server"
  // modules, and the editor is loaded lazily from its own file.
  entry: ["src/index.ts", "src/chromium.ts", "src/admin/index.ts"],
  unbundle: true,
  deps: { neverBundle: [/^node:/] },
  format: "esm",
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: true,
  clean: true,
  // Directives are kept by `unbundle`; the warning does not apply.
  inputOptions: { checks: { moduleLevelDirective: false } },
  // publint runs after the CSS build, in the `build` script.
  publint: false,
});
