import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import type { Cell } from "../readers/types";
import type { ActivationContext, Db, ImportProfile, Issue, ParsedRow } from "../profile";
import { orphanFingerprintsSql } from "../provenance";

/**
 * Perfiles SINTÉTICOS para probar el motor. No son importadores operativos: solo se registran en
 * un entorno de test aislado (ver registry.ts) y sus tablas viven en el esquema csapp_synthetic,
 * que crea el arranque de pruebas (tests/synthetic/schema.ts) y que no existe en producción.
 */
export const SYNTHETIC_SCHEMA = "csapp_synthetic";

const HEADER = ["id", "nombre", "fecha", "importe", "categoria"];

function toIso(c: Cell): string | null {
  const v = c.v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    return d.toISOString().slice(0, 10) === v ? v : null;
  }
  if (c.k === "date" && /^\d+(\.\d+)?$/.test(v)) {
    // Serie de Excel (sistema 1900).
    const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function toDecimal(raw: string): string | null {
  const v = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  let [i, f = ""] = v.split(".");
  f = f.replace(/0+$/, "");
  i = i.replace(/^(-?)0+(?=\d)/, "$1");
  return f ? `${i}.${f}` : i;
}

function parseRow(cells: Cell[]): ParsedRow {
  const issues: Issue[] = [];
  const get = (i: number) => (cells[i]?.v ?? "").replace(/\s+/g, " ").trim();
  const id = get(0);
  const nombre = get(1);
  const categoria = get(4);
  if (!id) issues.push({ severity: "error", code: "ID_VACIO", message: "El id es obligatorio.", column: "id" });
  const fecha = cells[2] ? toIso(cells[2]) : null;
  if (!fecha) issues.push({ severity: "error", code: "FECHA_INVALIDA", message: "La fecha no es válida (AAAA-MM-DD).", column: "fecha" });
  const importe = toDecimal(get(3));
  if (importe === null) issues.push({ severity: "error", code: "IMPORTE_ILEGIBLE", message: "El importe no es un número.", column: "importe" });
  if (!nombre) issues.push({ severity: "warning", code: "NOMBRE_VACIO", message: "Nombre vacío.", column: "nombre" });
  const typed = { id, nombre, fecha, importe, categoria };
  const exclude = categoria.toUpperCase() === "SIN-RELACION"
    ? { code: "RELACION_NO_RESUELTA", message: "La categoría no tiene relación en el maestro; queda fuera del cálculo." }
    : undefined;
  return { typed, issues, entityKey: id || undefined, exclude };
}

async function rulesVersion(db: Db): Promise<string> {
  const rows = await db.$queryRaw<{ value: string }[]>(
    Prisma.sql`SELECT value FROM csapp_synthetic.settings WHERE key = 'rules_version'`,
  );
  return rows[0]?.value ?? "0";
}

const stagedSelect = (batchId: string, dispositions: string[] | null) => Prisma.sql`
  SELECT fingerprint, "entityKey", typed->>'nombre' AS nombre, (typed->>'fecha')::date AS fecha,
         (typed->>'importe')::numeric AS importe, typed->>'categoria' AS categoria
  FROM "UploadStagedRow"
  WHERE "batchId" = ${batchId} AND classification = 'VALID' AND "duplicateInFile" = false
  ${dispositions ? Prisma.sql`AND disposition IN (${Prisma.join(dispositions)})` : Prisma.empty}
  ORDER BY position`;

const base = {
  version: 1,
  formats: ["csv", "xlsx"] as ("csv" | "xlsx")[],
  matchHeaders(row: string[]) {
    const norm = row.map((c) => c.trim().toLowerCase()).filter((c, i, a) => c !== "" || i < a.length - 1);
    const trimmed = norm.slice(0, HEADER.length);
    return trimmed.length === HEADER.length && HEADER.every((h, i) => trimmed[i] === h)
      ? ({ ok: true, schemaVersion: "v1" } as const)
      : ({ ok: false, message: `Las cabeceras no corresponden al perfil sintético v1 (${HEADER.join(", ")}).` } as const);
  },
  parseRow,
  rulesFingerprint: rulesVersion,
};

export const syntheticIncorporar: ImportProfile = {
  ...base,
  id: "sintetico-incorporar",
  label: "Sintético · incorporar y revisar (solo pruebas)",
  description: "Perfil de prueba del motor con política de incorporación/revisión. No es una fuente operativa.",
  policy: "INCORPORATE",
  metadataFields: [],
  metadataSchema: z.object({}).strict(),
  async activate(tx, ctx: ActivationContext) {
    const counts = await tx.$queryRaw<{ disposition: string; n: bigint }[]>(Prisma.sql`
      SELECT disposition, count(*) AS n FROM "UploadStagedRow"
      WHERE "batchId" = ${ctx.batchId} AND classification = 'VALID' AND "duplicateInFile" = false
        AND disposition IN ('NEW','REVISION') GROUP BY disposition`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO csapp_synthetic.record (fingerprint, entity_key, name, fecha, importe, categoria, batch_id)
      SELECT fingerprint, "entityKey", nombre, fecha, importe, categoria, ${ctx.batchId}
      FROM (${stagedSelect(ctx.batchId, ["NEW", "REVISION"])}) s
      ON CONFLICT (fingerprint) DO NOTHING`);
    await refreshCurrent(tx);
    const n = (d: string) => Number(counts.find((c) => c.disposition === d)?.n ?? 0);
    return { inserted: n("NEW"), revised: n("REVISION") };
  },
  async revert(tx, ctx) {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM csapp_synthetic.record WHERE fingerprint IN (${orphanFingerprintsSql(ctx.batchId)})`);
    await refreshCurrent(tx);
  },
};

async function refreshCurrent(tx: Prisma.TransactionClient) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE csapp_synthetic.record r SET is_current = (r.id = m.maxid)
    FROM (SELECT entity_key, max(id) AS maxid FROM csapp_synthetic.record WHERE entity_key IS NOT NULL GROUP BY entity_key) m
    WHERE r.entity_key = m.entity_key`);
}

export const syntheticSustituir: ImportProfile = {
  ...base,
  id: "sintetico-sustituir",
  label: "Sintético · sustituir ámbito (solo pruebas)",
  description: "Perfil de prueba del motor con sustitución atómica por ámbito (A o B). No es una fuente operativa.",
  policy: "REPLACE_SCOPE",
  metadataFields: [
    {
      name: "ambito",
      label: "Ámbito a sustituir",
      type: "select",
      required: true,
      options: [
        { value: "A", label: "Ámbito A" },
        { value: "B", label: "Ámbito B" },
      ],
    },
  ],
  metadataSchema: z.object({ ambito: z.enum(["A", "B"], { error: "Indique el ámbito (A o B)." }) }).strict(),
  scopeKey: (m) => String(m.ambito),
  async activate(tx, ctx) {
    await tx.$executeRaw(Prisma.sql`DELETE FROM csapp_synthetic.scoped WHERE scope = ${ctx.scopeKey}`);
    const inserted = await tx.$executeRaw(Prisma.sql`
      INSERT INTO csapp_synthetic.scoped (scope, batch_id, fingerprint, entity_key, name, fecha, importe, categoria)
      SELECT ${ctx.scopeKey}, ${ctx.batchId}, fingerprint, "entityKey", nombre, fecha, importe, categoria
      FROM (${stagedSelect(ctx.batchId, null)}) s`);
    return { inserted, revised: 0 };
  },
  async revert(tx, ctx) {
    await tx.$executeRaw(Prisma.sql`DELETE FROM csapp_synthetic.scoped WHERE batch_id = ${ctx.batchId}`);
    if (ctx.previousBatchId) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO csapp_synthetic.scoped (scope, batch_id, fingerprint, entity_key, name, fecha, importe, categoria)
        SELECT ${ctx.scopeKey}, ${ctx.previousBatchId}, fingerprint, "entityKey", nombre, fecha, importe, categoria
        FROM (${stagedSelect(ctx.previousBatchId, null)}) s`);
    }
  },
};
