import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { cleanText, isDigits } from "@/domain/normalize";
import {
  COMPLEXITY_MAP,
  HOSTING_MAP,
  KNOWN_LEVELS,
  KNOWN_ROLES,
  KNOWN_TEAMS,
  PRECARGA_PROFILE_ID,
  PRECARGA_RULES,
  SUPPORT_MAP,
  detectSheet,
  knownLabel,
  nonEmployeeReason,
  norm,
  rowPmo,
  termValue,
  type ClienteTyped,
  type PersonalTyped,
  type PmoTyped,
  type SheetKind,
} from "@/domain/precarga-maestros";
import { reviewCandidates } from "@/domain/precarga-maestros-revision";
import type { HeaderMatch, ImportProfile, Issue, ParsedRow } from "../uploads/profile";
import type { Cell } from "../uploads/readers/types";
import { activatePrecarga } from "./apply";
import { loadPlan } from "./rows";

type Tx = Prisma.TransactionClient;
type Ctx = { kind: SheetKind };

const err = (code: string, message: string, column?: string): Issue => ({ severity: "error", code, message, column });
const warn = (code: string, message: string, column?: string): Issue => ({ severity: "warning", code, message, column });

/** Texto de una celda por POSICIÓN (las cabeceras se repiten): vacío = null. No se evalúa ninguna fórmula. */
function text(cells: Cell[], i: number): string | null {
  const v = cleanText(cells[i]?.v ?? "");
  return v === "" ? null : v;
}


function matchHeaders(row: string[]): HeaderMatch {
  const m = detectSheet(row);
  if (m.kind === null) return { ok: false, message: m.message };
  const notes = m.extras.length > 0 ? [`Hoja ${m.kind}: columnas adicionales conservadas y no utilizadas: ${m.extras.join(", ")}.`] : [];
  return { ok: true, schemaVersion: "v1-hojas-de-carga", context: { kind: m.kind } satisfies Ctx, notes };
}

function parseClientes(cells: Cell[]): ParsedRow {
  const issues: Issue[] = [];
  const idCell = cells[2];
  let zdId = text(cells, 2);
  if (idCell?.k === "error") {
    issues.push(err("ID_ZENDESK_ERROR", "El ID de Zendesk es una celda con error de Excel.", "C"));
    zdId = null;
  } else if (zdId !== null && !isDigits(zdId)) {
    // Un ID es texto exacto: no se acepta notación científica ni decimales (se habría perdido precisión).
    issues.push(err("ID_ZENDESK_NO_ENTERO", "El ID de Zendesk debe ser un entero exacto (solo dígitos); la celda no lo es.", "C"));
    zdId = null;
  }
  const t: ClienteTyped = {
    hoja: "CLIENTES",
    wrike: text(cells, 0),
    wrikeGrupo: text(cells, 1),
    zdId,
    zdNombre: text(cells, 3),
    zdGrupo: text(cells, 5),
    soporteE: text(cells, 4),
    servidor: text(cells, 6),
    soporteH: text(cells, 7),
    pap: text(cells, 8),
    papGrupo: text(cells, 9),
    tipo: text(cells, 10),
  };
  if (!zdId && !issues.some((i) => i.column === "C")) {
    issues.push(err("ID_ZENDESK_AUSENTE", "La fila no tiene ID de organización Zendesk: no identifica un Cliente y no se carga.", "C"));
  }
  if (!t.zdNombre) issues.push(err("NOMBRE_CLIENTE_AUSENTE", "La fila no tiene nombre de organización Zendesk.", "D"));
  for (const [v, col, label, map] of [
    [t.soporteE, "E", "Nivel de servicio (E)", SUPPORT_MAP],
    [t.soporteH, "H", "Nivel de servicio (H)", SUPPORT_MAP],
    [t.servidor, "G", "Servidor", HOSTING_MAP],
    [t.tipo, "K", "Tipo (complejidad)", COMPLEXITY_MAP],
  ] as const) {
    if (v && !map[norm(v)]) issues.push(warn("VALOR_NO_RECONOCIDO", `${label}: «${v}» no es un valor permitido; ese dato queda pendiente (el Cliente sí se carga).`, col));
  }
  const e = termValue("SUPPORT", t.soporteE);
  const h = termValue("SUPPORT", t.soporteH);
  if (e && h && e !== h) issues.push(warn("SOPORTE_DISTINTO", "Las dos columnas de nivel de servicio (E y H) discrepan: se carga el Cliente y el Soporte queda pendiente de revisión.", "E"));
  return { typed: t, issues };
}

function parsePersonal(cells: Cell[]): ParsedRow {
  const issues: Issue[] = [];
  const pmoCell = cells[4];
  const rawPmo = cleanText(pmoCell?.v ?? "");
  let pmo: 0 | 1 | null = null;
  if (pmoCell?.k === "error") issues.push(warn("PMO_ERROR", "La columna PMO es una celda con error de Excel: se ignora.", "E"));
  else if (rawPmo === "0" || rawPmo === "1") pmo = rawPmo === "1" ? 1 : 0;
  else if (rawPmo !== "") issues.push(warn("PMO_NO_RECONOCIDO", `La columna PMO («${rawPmo}») no es 0 ni 1: se ignora.`, "E"));
  const t: PersonalTyped = {
    hoja: "PERSONAL",
    papAlias: text(cells, 0),
    zdName: text(cells, 1),
    level: text(cells, 2),
    team: text(cells, 3),
    pmo,
    pmoFormula: pmoCell?.f === true,
    wrike: text(cells, 5),
    zdName2: text(cells, 6),
  };
  const reason = nonEmployeeReason(t);
  if (reason) return { typed: t, issues: [], exclude: reason };
  if (!t.papAlias && !t.zdName && !t.zdName2 && !t.wrike) issues.push(err("PERSONA_SIN_IDENTIDAD", "La fila no tiene ningún alias de persona (PAP, Zendesk ni Wrike)."));
  if (t.level && !knownLabel(KNOWN_LEVELS, t.level)) issues.push(warn("NIVEL_NO_RECONOCIDO", `Nivel «${t.level}» no previsto (${KNOWN_LEVELS.join(", ")}): no se carga.`, "C"));
  if (t.team && !knownLabel(KNOWN_TEAMS, t.team)) issues.push(warn("EQUIPO_NO_RECONOCIDO", `Equipo «${t.team}» no previsto (${KNOWN_TEAMS.join(", ")}): no se carga.`, "D"));
  if (t.zdName && t.zdName2 && norm(t.zdName) !== norm(t.zdName2)) {
    issues.push(warn("ZENDESK_B_G_DISTINTOS", "Las dos columnas «Persona Zendesk» (B y G) no coinciden: solo se carga la primera.", "G"));
  }
  const p = rowPmo(t);
  if (p.issue) issues.push(warn(p.issue, "La pertenencia a PMO no se carga: no es coherente con el Equipo o procede de una fórmula sin Equipo.", "E"));
  if (!t.level || !t.team) issues.push(warn("PERSONAL_INCOMPLETA", "Fila incompleta: se carga la identidad y los alias conocidos sin inventar el nivel ni el equipo que faltan."));
  return { typed: t, issues };
}

function parsePmo(cells: Cell[]): ParsedRow {
  const issues: Issue[] = [];
  const t: PmoTyped = { hoja: "PERSONAL PMO", persona: text(cells, 0), perfil: text(cells, 1) };
  if (!t.persona) issues.push(err("PERSONA_AUSENTE", "La fila no indica la persona.", "A"));
  if (t.perfil && !knownLabel(KNOWN_ROLES, t.perfil)) issues.push(warn("PERFIL_NO_RECONOCIDO", `Perfil «${t.perfil}» no previsto (${KNOWN_ROLES.join(", ")}): el rol queda desconocido.`, "B"));
  if (!t.perfil) issues.push(warn("PERFIL_AUSENTE", "Sin perfil: el rol sigue desconocido.", "B"));
  return { typed: t, issues };
}

function parseRow(cells: Cell[], context?: unknown): ParsedRow {
  const { kind } = context as Ctx;
  return kind === "CLIENTES" ? parseClientes(cells) : kind === "PERSONAL" ? parsePersonal(cells) : parsePmo(cells);
}

// ---------------------------------------------------------------- Posproceso: contradicciones entre filas y avisos de revisión

const ERR = (code: string, message: string) => JSON.stringify([{ severity: "error", code, message }]);
const WARN = (code: string, message: string) => JSON.stringify([{ severity: "warning", code, message }]);

async function postPrepare(tx: Tx, batchId: string): Promise<void> {
  // 1. Un mismo ID Zendesk con nombre o Grupo distintos en filas distintas es una contradicción del bloque Zendesk (C/D/F): el plan no crea ese Cliente ni elige uno
  //    (HOTFIX-02 §3). La fila NO es un error: sus columnas Wrike (A/B) y PAP (I/J) son claves independientes y siguen su camino. Se avisa en cada fila.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET "hasWarning" = true,
      issues = COALESCE(r.issues, '[]'::jsonb) || ${WARN("ZENDESK_ID_CONTRADICTORIO", "El mismo ID de organización Zendesk aparece con nombre o Grupo distintos en otras filas: no se crea ese Cliente ni se elige uno; los alias Wrike y PAP de la fila sí se cargan.")}::jsonb
    FROM (
      SELECT typed->>'zdId' AS zid FROM "UploadStagedRow"
      WHERE "batchId" = ${batchId} AND classification = 'VALID' AND typed->>'hoja' = 'CLIENTES'
      GROUP BY 1 HAVING count(DISTINCT lower(btrim(typed->>'zdNombre'))) > 1 OR count(DISTINCT lower(COALESCE(typed->>'zdGrupo', ''))) > 1) c
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r.typed->>'hoja' = 'CLIENTES' AND r.typed->>'zdId' = c.zid`);
  // 2. Dos IDs distintos con el mismo nombre dentro del mismo Grupo no pueden ser dos Clientes (clave única del maestro): no se activa ninguna.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "UploadStagedRow" r SET classification = 'ERROR', fingerprint = NULL, "entityKey" = NULL, "duplicateInFile" = false, disposition = NULL, derived = NULL,
      issues = COALESCE(r.issues, '[]'::jsonb) || ${ERR("NOMBRE_CLIENTE_REPETIDO_EN_GRUPO", "Dos IDs de Zendesk distintos comparten nombre dentro del mismo Grupo: no se activa ninguna de las filas.")}::jsonb
    FROM (
      SELECT lower(COALESCE(typed->>'zdGrupo', '')) AS g, lower(btrim(typed->>'zdNombre')) AS n FROM "UploadStagedRow"
      WHERE "batchId" = ${batchId} AND classification = 'VALID' AND typed->>'hoja' = 'CLIENTES'
      GROUP BY 1, 2 HAVING count(DISTINCT typed->>'zdId') > 1) c
    WHERE r."batchId" = ${batchId} AND r.classification = 'VALID' AND r.typed->>'hoja' = 'CLIENTES'
      AND lower(COALESCE(r.typed->>'zdGrupo', '')) = c.g AND lower(btrim(r.typed->>'zdNombre')) = c.n`);

  // 3. Revisiones que se derivan del propio archivo: se marcan como aviso en sus filas (la ficha las explica y permite decidir tras activar).
  const plan = await loadPlan(tx, batchId);
  for (const c of reviewCandidates(plan).filter((x) => x.state === "pending" || x.kind === "PERSON_VARIANT")) {
    if (c.positions.length === 0) continue;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "UploadStagedRow" SET "hasWarning" = true,
        issues = COALESCE(issues, '[]'::jsonb) || ${JSON.stringify([{ severity: "warning", code: `REVISION_${c.kind}`, message: `${c.title}: ${c.message}` }])}::jsonb
      WHERE "batchId" = ${batchId} AND position = ANY(${c.positions}::int[]) AND classification = 'VALID'`);
  }
}

export const precargaMaestros: ImportProfile = {
  id: PRECARGA_PROFILE_ID,
  label: "Precarga de maestros (hojas de carga)",
  description:
    "Libro «HOJAS DE CARGA» con las hojas CLIENTES, PERSONAL y PERSONAL PMO. Crea lo que falta en los maestros (Grupos, Clientes, equivalencias, implantaciones, personas, alias, " +
    "equipo/nivel/PMO y roles) y reutiliza lo que ya existe; lo ambiguo queda como revisión en la ficha del lote. No crea cuentas de acceso.",
  note: "Solo el archivo. Repetir o reordenar el mismo libro no duplica nada ni sobrescribe cambios hechos después en los maestros.",
  version: 1,
  formats: ["xlsx"],
  // INCORPORATE: la activación es idempotente (crea lo ausente, reutiliza lo inequívoco). No hay «conjunto que se sustituye».
  policy: "INCORPORATE",
  metadataFields: [],
  metadataSchema: z.object({}).strict(),
  matchHeaders,
  parseRow,
  async rulesFingerprint() {
    return PRECARGA_RULES;
  },
  postPrepare,
  activate: activatePrecarga,
  // Sin `revert`: lo creado puede haberse editado, usado en hechos o desactivado después. Se deshace desde cada maestro (desactivar).
};
