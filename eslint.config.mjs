import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "apps/mobile/android/**", "apps/mobile/ios/**", "apps/mobile/dist/**"]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    rules: {
      "@next/next/no-html-link-for-pages": "off"
    }
  }
]);
