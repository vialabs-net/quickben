import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";

const literalMessage =
  "UI text must come from a message catalog (i18n.t / useAdminI18n), not an English literal.";

/** Props whose string values are shown to people. */
const textProps =
  "aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|placeholder|title|alt|label|description|message|submitLabel|confirmLabel|hint|emptyText";

/**
 * `no-restricted-syntax` selectors that find English text in JSX: text children, string
 * literals in `{…}`, and string values of text props such as `aria-label` and `placeholder`.
 */
const child = ":matches(JSXElement, JSXFragment) > JSXExpressionContainer";
const textProp = `JSXAttribute[name.name=/^(${textProps})$/] > JSXExpressionContainer`;
const branches = (container) =>
  `:matches(${container}, ${container} > ConditionalExpression, ${container} > LogicalExpression)`;
const word = "[value=/[A-Za-z]{2,}/]";

export const uiLiteralRules = [
  { selector: `JSXText${word}`, message: literalMessage },
  {
    selector: `JSXAttribute[name.name=/^(${textProps})$/] > Literal${word}`,
    message: literalMessage,
  },
  { selector: `${branches(child)} > Literal${word}`, message: literalMessage },
  { selector: `${branches(textProp)} > Literal${word}`, message: literalMessage },
  {
    selector: `${branches(child)} > TemplateLiteral > TemplateElement[value.raw=/[A-Za-z]{2,}/]`,
    message: literalMessage,
  },
  {
    selector: `${branches(textProp)} > TemplateLiteral > TemplateElement[value.raw=/[A-Za-z]{2,}/]`,
    message: literalMessage,
  },
];

/**
 * Shared flat config for Quickben packages and apps.
 *
 * @param {{ tsconfigRootDir: string, uiFiles?: string[] }} options `tsconfigRootDir` is the
 *   package directory (pass `import.meta.dirname`). `uiFiles` are globs of UI components
 *   whose text must come from message catalogs: English literals in JSX are errors there.
 */
export function quickben({ tsconfigRootDir, uiFiles = [] }) {
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
      files: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.test-d.ts",
        "**/test/**/*.{ts,tsx}",
        "**/e2e/**/*.ts",
      ],
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
    ...(uiFiles.length > 0
      ? [{ files: uiFiles, rules: { "no-restricted-syntax": ["error", ...uiLiteralRules] } }]
      : []),
    prettier,
  );
}

export default quickben;
