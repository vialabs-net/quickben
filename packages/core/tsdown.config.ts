import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", http: "src/http/index.ts" },
  format: "esm",
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: true,
  clean: true,
  publint: true,
});
