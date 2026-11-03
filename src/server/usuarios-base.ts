import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/access";
import { usersBaseResolveSchema } from "@/domain/usuarios-schemas";
import { USERS_BASE_YEAR } from "@/domain/usuarios";
import { CATEGORY_LABEL, type FinanceCategory } from "@/domain/finance";
import { authorize } from "./authorize";
import { recordAudit } from "./audit";
import { adminTransaction } from "./tx";
import { DomainError } from "./errors";
import { parseInput } from "./parse";
import { seedGroupUsersFromBase, type SeededYear } from "./usuarios";

type Tx = Prisma.TransactionClient;

/**
 * Base de usuarios 2025 del libro histórico (HOTFIX-01 §7). La columna H es un dato por fila financiera: un Grupo puede aparecer en Soporte y en
 * Administración delegada. Las filas NO se suman. Si todas las categorías informadas coinciden, la base es ese valor; si difieren, es una
 * discrepancia que se conserva con sus dos valores y contexto y solo se resuelve por elección explícita (nunca máximo, suma ni último).
 * Mientras no se resuelva, el denominador del Grupo queda sin informar (null), nunca cero.
 */
export type UsersBaseEntry = { category: FinanceCategory; value: number; sourceRow: number; cell: string; fromFormula: boolean };
export type UsersBaseInput = { groupId: string; entries: UsersBaseEntry[]; historicYears: number[] };

export type UsersBaseOutcome = {
  resolved: { groupId: string; value: number; seeded: SeededYear[] }[];
  conflicts: { groupId: string; values: number[] }[];
  alreadyDecided: number;
};

const sourceOf = (e: UsersBaseEntry) => `Base ${USERS_BASE_YEAR} del libro histórico (${CATEGORY_LABEL[e.category]}, ${e.cell})`;

/** Registra las entradas de la base y, para los Grupos sin discrepancia, inicializa su matriz sin pisar valores. Se llama dentro de la transacción de activación. */
export async function applyHistoricUsersBase(tx: Tx, actor: Actor, batchId: string, inputs: UsersBaseInput[]): Promise<UsersBaseOutcome> {
  const out: UsersBaseOutcome = { resolved: [], conflicts: [], alreadyDecided: 0 };
  for (const g of [...inputs].sort((a, b) => a.groupId.localeCompare(b.groupId))) {
    for (const e of g.entries) {
      await tx.historicUserBase.upsert({
        where: { groupId_year_category: { groupId: g.groupId, year: USERS_BASE_YEAR, category: e.category } },
        create: { groupId: g.groupId, year: USERS_BASE_YEAR, category: e.category, value: e.value, sourceRow: e.sourceRow, sourceCell: e.cell, fromFormula: e.fromFormula, batchId },
        update: { value: e.value, sourceRow: e.sourceRow, sourceCell: e.cell, fromFormula: e.fromFormula, batchId },
      });
    }
    const distinct = [...new Set(g.entries.map((e) => e.value))];
    const decided = await tx.historicUserResolution.findUnique({ where: { groupId_year: { groupId: g.groupId, year: USERS_BASE_YEAR } } });
    if (decided) {
      out.alreadyDecided++;
      continue;
    }
    if (distinct.length > 1) {
      out.conflicts.push({ groupId: g.groupId, values: distinct.sort((a, b) => a - b) });
      continue;
    }
    const seeded = await seedGroupUsersFromBase(tx, actor, g.groupId, distinct[0], { baseSource: sourceOf(g.entries[0]), historicYears: g.historicYears });
    out.resolved.push({ groupId: g.groupId, value: distinct[0], seeded });
  }
  return out;
}

/** Años anteriores a la base en los que el Grupo tiene ingresos en un conjunto financiero vigente (dónde «existe» el Grupo). */
export async function historicYearsOfGroup(tx: Tx | typeof prisma, groupId: string): Promise<number[]> {
  const r = await tx.$queryRaw<{ year: number }[]>(Prisma.sql`
    SELECT DISTINCT s.year FROM "FinanceScope" s JOIN "FinanceRow" r ON r."batchId" = s."activeBatchId"
    WHERE r."groupId" = ${groupId} AND s.year < ${USERS_BASE_YEAR} ORDER BY s.year`);
  return r.map((x) => x.year);
}

export type GroupUsersBase = {
  groupId: string;
  year: number;
  candidates: { category: FinanceCategory; value: number; sourceRow: number; cell: string; fromFormula: boolean }[];
  distinctValues: number[];
  status: "SIN_BASE" | "UNICA" | "DISCREPANCIA" | "RESUELTA";
  resolution: { category: FinanceCategory | null; value: number; reason: string | null; decidedAt: Date } | null;
};

export async function getGroupUsersBase(actorId: string, groupId: string): Promise<GroupUsersBase> {
  await authorize(prisma, actorId, "READ");
  const [rows, res] = await Promise.all([
    prisma.historicUserBase.findMany({ where: { groupId, year: USERS_BASE_YEAR }, orderBy: { category: "asc" } }),
    prisma.historicUserResolution.findUnique({ where: { groupId_year: { groupId, year: USERS_BASE_YEAR } } }),
  ]);
  const candidates = rows.map((r) => ({ category: r.category as FinanceCategory, value: r.value, sourceRow: r.sourceRow, cell: r.sourceCell, fromFormula: r.fromFormula }));
  const distinctValues = [...new Set(candidates.map((c) => c.value))].sort((a, b) => a - b);
  const status: GroupUsersBase["status"] = res ? "RESUELTA" : candidates.length === 0 ? "SIN_BASE" : distinctValues.length > 1 ? "DISCREPANCIA" : "UNICA";
  return { groupId, year: USERS_BASE_YEAR, candidates, distinctValues, status, resolution: res ? { category: res.category as FinanceCategory | null, value: res.value, reason: res.reason, decidedAt: res.decidedAt } : null };
}

/** Grupos con valores distintos por categoría y sin elección explícita (pendientes de resolver). */
export async function listUsersBaseConflicts(actorId: string) {
  await authorize(prisma, actorId, "READ");
  const rows = await prisma.$queryRaw<{ groupId: string; name: string; entries: { category: string; value: number; cell: string }[] }[]>(Prisma.sql`
    SELECT b."groupId", g.name, jsonb_agg(jsonb_build_object('category', b.category, 'value', b.value, 'cell', b."sourceCell") ORDER BY b.category) AS entries
    FROM "HistoricUserBase" b JOIN "ClientGroup" g ON g.id = b."groupId"
    WHERE b.year = ${USERS_BASE_YEAR}
      AND NOT EXISTS (SELECT 1 FROM "HistoricUserResolution" r WHERE r."groupId" = b."groupId" AND r.year = b.year)
    GROUP BY b."groupId", g.name HAVING count(DISTINCT b.value) > 1 ORDER BY g.name`);
  return rows;
}

/**
 * Resuelve explícitamente la base 2025 de un Grupo en discrepancia: elige la categoría cuyo valor vale (o escribe un valor) y deja constancia.
 * Después inicializa la matriz del Grupo con el mismo criterio de la precarga (solo meses sin informar). Solo Administrador; revalida en servidor.
 */
export async function resolveUsersBase(actorId: string, raw: unknown, _opts: { now?: Date } = {}) {
  void _opts;
  const input = parseInput(usersBaseResolveSchema, raw);
  return adminTransaction(actorId, async (tx, actor) => {
    const group = await tx.clientGroup.findUnique({ where: { id: input.groupId }, select: { id: true, name: true } });
    if (!group) throw new DomainError("Grupo no encontrado.");
    // Serializa resoluciones simultáneas del mismo Grupo.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`usersbase|${group.id}`}, 0))`);
    if (await tx.historicUserResolution.findUnique({ where: { groupId_year: { groupId: group.id, year: USERS_BASE_YEAR } } })) {
      throw new DomainError("Este Grupo ya tiene una base 2025 resuelta explícitamente.");
    }
    const cands = await tx.historicUserBase.findMany({ where: { groupId: group.id, year: USERS_BASE_YEAR } });
    if (new Set(cands.map((c) => c.value)).size < 2) throw new DomainError("Este Grupo no tiene una discrepancia de base 2025 pendiente.");
    let value: number;
    let category: FinanceCategory | null = null;
    let source: string;
    if (input.category) {
      const c = cands.find((x) => x.category === input.category);
      if (!c) throw new DomainError("Esa categoría no aporta un valor de base para este Grupo.", { category: "Categoría sin valor." });
      value = c.value;
      category = c.category as FinanceCategory;
      source = `Base ${USERS_BASE_YEAR} elegida expresamente: ${CATEGORY_LABEL[category]} (${c.sourceCell})`;
    } else if (input.value !== undefined) {
      value = input.value;
      source = `Base ${USERS_BASE_YEAR} indicada expresamente por el administrador`;
    } else {
      throw new DomainError("Elija una de las categorías o indique el valor.", { category: "Elección obligatoria." });
    }
    await tx.historicUserResolution.create({ data: { groupId: group.id, year: USERS_BASE_YEAR, category, value, reason: input.reason ?? null, decidedById: actor.id } });
    const seeded = await seedGroupUsersFromBase(tx, actor, group.id, value, { baseSource: source, historicYears: await historicYearsOfGroup(tx, group.id) });
    await recordAudit(tx, actor, {
      action: "UPDATE",
      entityType: "HistoricUserBase",
      entityId: `${group.id}:${USERS_BASE_YEAR}`,
      groupId: group.id,
      summary: `Base de usuarios ${USERS_BASE_YEAR} de ${group.name} resuelta: ${value} (${category ? CATEGORY_LABEL[category] : "valor indicado"}); valores en discrepancia: ${cands.map((c) => `${CATEGORY_LABEL[c.category as FinanceCategory]} ${c.value}`).join(" / ")}`,
      before: { candidates: cands.map((c) => ({ category: c.category, value: c.value, cell: c.sourceCell })) },
      after: { value, category, reason: input.reason ?? null, seeded },
    });
    return { groupId: group.id, value, seeded };
  });
}
