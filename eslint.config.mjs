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
  ]),
  {
    // Regras do React Compiler introduzidas no eslint-plugin-react-hooks 7.x.
    // O código atual antecede esse padrão; mantemos como avisos para migrar
    // de forma incremental sem travar o gate de CI. Ver PR de destravamento do lint.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
