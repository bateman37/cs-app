import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** CSAPP-10 §3: `.env.example` y el catálogo de variables están sincronizados con el código (ninguna variable CSAPP_* leída sin documentar). */
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (["generated", "node_modules", ".next"].includes(n)) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(n)) out.push(p);
  }
  return out;
}
const used = (() => {
  const set = new Set<string>();
  for (const f of [...walk("src"), ...walk("scripts")]) for (const m of readFileSync(f, "utf8").matchAll(/\b(CSAPP_[A-Z0-9_]+|TEST_DATABASE_URL|SHADOW_DATABASE_URL|BETTER_AUTH_[A-Z]+|DATABASE_URL)\b/g)) set.add(m[1]);
  return [...set].filter((v) => !v.endsWith("_")).sort();
})();

describe("variables de entorno", () => {
  const example = readFileSync(".env.example", "utf8");
  const catalog = readFileSync("docs/operacion/variables-entorno.md", "utf8");
  it("todas las variables que lee el código figuran en .env.example y en el catálogo", () => {
    const missingExample = used.filter((v) => !example.includes(v));
    const missingCatalog = used.filter((v) => !catalog.includes(v));
    expect(missingExample, "faltan en .env.example").toEqual([]);
    expect(missingCatalog, "faltan en docs/operacion/variables-entorno.md").toEqual([]);
  });
  it("el catálogo no promete variables que el código no usa (salvo las de recorridos)", () => {
    const listed = [...catalog.matchAll(/`((?:CSAPP|E2E)_[A-Z0-9_]+|TEST_DATABASE_URL|SHADOW_DATABASE_URL)`/g)].map((m) => m[1]);
    const ghost = listed.filter((v) => !used.includes(v) && !v.startsWith("E2E_") && !["CSAPP_EXPORT_MAX_ACTIVE_PER_USER"].includes(v));
    expect(ghost).toEqual([]);
  });
  it(".env.example no contiene secretos reales ni valores operativos", () => {
    expect(example).toMatch(/BETTER_AUTH_SECRET=""/);
    expect(example).not.toMatch(/postgresql:\/\/[^"\s]*:[A-Za-z0-9]{8,}@/);
  });
});
