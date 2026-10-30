import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "src/generated/**", "node_modules/**", "next-env.d.ts", "worker-dist/**", ".claude/**"] },
];

export default config;
