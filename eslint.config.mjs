import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CloudFront Functions run in a constrained JS runtime that calls
    // top-level `handler` implicitly — eslint can't see the invocation.
    "terraform/cloudfront-functions/**",
    // Static assets synced from node_modules by postinstall. Not source —
    // linting upstream bundles produces thousands of meaningless warnings.
    "public/onnx/**",
  ]),
]);

export default eslintConfig;
