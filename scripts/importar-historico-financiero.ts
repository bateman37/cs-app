/**
 * Vía asistida para financieros anteriores a 2025 (hoja «DATA FACTURACIÓN»). Simulación por defecto.
 *
 *   npx tsx scripts/importar-historico-financiero.ts --archivo RUTA.xlsx --admin correo@dominio            (simulación)
 *   npx tsx scripts/importar-historico-financiero.ts --archivo RUTA.xlsx --admin correo@dominio --aplicar  (escribe)
 *
 * No se ejecuta en migración, arranque ni instalación. El libro nunca se sube al repositorio; se lee desde la ruta indicada.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { importHistoricFinance, readHistoricRows } from "../src/server/finance/history";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("archivo");
  const email = arg("admin");
  const apply = process.argv.includes("--aplicar");
  if (!file || !email) {
    console.error("Uso: --archivo RUTA.xlsx --admin correo [--hoja NOMBRE] [--aplicar]");
    process.exit(2);
  }
  const admin = await prisma.user.findUnique({ where: { email } });
  if (!admin || admin.role !== "ADMIN" || !admin.isActive) {
    console.error("El usuario indicado no es un administrador activo.");
    process.exit(2);
  }
  const { header, rows } = await readHistoricRows(file, arg("hoja"));
  const r = await importHistoricFinance(admin.id, { header, rows, apply });
  console.log(apply ? "MODO: aplicar" : "MODO: simulación (no se escribe nada; use --aplicar)");
  for (const s of r.scopes) console.log(`${s.year} ${s.category}: ${s.outcome} · ${s.rows} grupos · ${s.total} €${s.conflicts.length ? ` · conflictos: ${s.conflicts.join("; ")}` : ""}`);
  console.log(`Filas leídas: ${r.plan.rowsRead}; omitidas: ${r.plan.skipped.length}`);
  for (const k of r.plan.skipped.slice(0, 50)) console.log(`  fila ${k.sourceRow}: ${k.code} — ${k.message}`);
  if (r.plan.ignoredColumns.length) console.log(`Columnas no usadas como ingreso: ${r.plan.ignoredColumns.join(", ")}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
