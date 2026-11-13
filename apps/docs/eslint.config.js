import nextPlugin from "@next/eslint-plugin-next";
import { quickben } from "@quickben/eslint-config";
import { defineConfig, globalIgnores } from "eslint/config";

// eslint-disable-next-line import-x/no-named-as-default-member -- CommonJS module
const { configs: nextConfigs, rules: nextRules } = nextPlugin;

export default defineConfig(
  globalIgnores(["samples/generated/**", "public/**", "next-env.d.ts"]),
  quickben({ tsconfigRootDir: import.meta.dirname }),
  {
    plugins: { "@next/next": { rules: nextRules } },
    rules: {
      ...nextConfigs.recommended.rules,
      ...nextConfigs["core-web-vitals"].rules,
    },
  },
  {
    // Packages that are not merged yet are typed by samples/coming.d.ts.
    files: ["samples/**/*.ts"],
    rules: {
      "import-x/no-unresolved": [
        "error",
        { ignore: ["^@quickben/(db-drizzle|next|admin|plugin-tenancy)$"] },
      ],
    },
  },
);
