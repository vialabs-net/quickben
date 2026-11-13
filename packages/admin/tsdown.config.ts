import { defineConfig } from "tsdown";

export default defineConfig({
  // One output file per source file, so "use client" and "use server" directives stay at the
  // top of the modules that declare them. Next.js reads them from the published files.
  entry: ["src/index.ts", "src/ui/index.ts"],
  unbundle: true,
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
