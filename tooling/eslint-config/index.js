import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for Quickben packages and apps.
 *
 * @param {{ tsconfigRootDir: string }} options `tsconfigRootDir` is the package directory
 *   (pass `import.meta.dirname`).
 */
export function quickben({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores(["**/dist/**", "**/coverage/**", "**/.turbo/**", "**/.next/**"]),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    sonarjs.configs.recommended,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      settings: {
        "import-x/resolver-next": [createTypeScriptImportResolver({ alwaysTryTypes: true })],
      },
      rules: {
        "no-console": ["error", { allow: ["warn", "error"] }],
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/consistent-type-definitions": "off",
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        "import-x/no-cycle": "error",
        "import-x/no-duplicates": "error",
        "import-x/no-self-import": "error",
        "import-x/order": [
          "error",
          {
            groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
            "newlines-between": "always",
            alphabetize: { order: "asc", caseInsensitive: true },
          },
        ],
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test-d.ts", "**/test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "sonarjs/no-duplicate-string": "off",
        "sonarjs/no-hardcoded-passwords": "off",
      },
    },
    {
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  );
}

export default quickben;
