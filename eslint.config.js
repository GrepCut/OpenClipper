import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "reference-algorithms/**",
      "mediapipe/**",
      "node_modules/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { unicorn },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "unicorn/filename-case": [
        "error",
        {
          cases: { kebabCase: true },
          ignore: [/^[a-z0-9]+(?:-[a-z0-9]+)*\.(component|service|hook|store|util|types|constants|test|font)\.(tsx?)$/u],
        },
      ],
    },
  },
  {
    // User-visible copy lives in components. Comments are not matched by these selectors,
    // so prose in code stays untouched.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/—/]",
          message: "Use a colon, comma, or sentence break instead of an em dash.",
        },
        {
          selector: "TemplateElement[value.raw=/—/]",
          message: "Use a colon, comma, or sentence break instead of an em dash.",
        },
        {
          selector: "JSXText[value=/—/]",
          message: "Use a colon, comma, or sentence break instead of an em dash.",
        },
      ],
    },
  },
  {
    files: ["src/main.tsx", "src/**/index.ts", "src/vite-env.d.ts"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
);
