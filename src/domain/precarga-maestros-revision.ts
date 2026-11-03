import { SUPPORT_LABEL, type PersonPlan, type Plan, type ReviewKind } from "./precarga-maestros";

/**
 * Revisiones de la precarga que se derivan solo del plan (sin consultar maestros).
 * `pending`: requiere una decisión o una corrección; `applied`: se aplicó una propuesta cautelosa y se muestra para que se confirme;
 * `info`: dato conservado (fila excluida, fila incompleta...).
 */
export type ReviewCandidate = {
  key: string;
  kind: ReviewKind;
  state: "pending" | "applied" | "info";
  title: string;
  message: string;
  positions: number[];
  decidable: boolean;
};

const PMO_ISSUE_TEXT: Record<string, string> = {
  PMO_FORMULA_SIN_EQUIPO: "El 0 de la columna PMO procede de la fórmula con el Equipo vacío: no prueba que no pertenezca a PMO. Se deja sin informar.",
  PMO_INCONSISTENTE_CON_EQUIPO: "La columna PMO no concuerda con el Equipo (PMO=1 solo con equipo PMO): no se carga la pertenencia a PMO.",
  PMO_CONTRADICTORIO: "Las filas de esta persona dan valores distintos de PMO: no se carga la pertenencia a PMO.",
};

export function reviewCandidates(plan: Plan): ReviewCandidate[] {
  const out: ReviewCandidate[] = [];
  const groupName = new Map(plan.groups.map((g) => [g.key, g.name]));
  const names = (keys: string[]) => keys.map((k) => `«${groupName.get(k) ?? k}»`).join(", ");
  for (const c of plan.clients) {
    if (c.support.candidates.length > 1) {
      out.push({
        key: `SUPPORT:${c.zdId}`, kind: "SUPPORT", state: "pending", title: `Soporte de «${c.name}»`, decidable: true, positions: c.positions,
        message: `Las dos columnas de nivel de servicio discrepan (${c.support.candidates.map((v) => SUPPORT_LABEL[v] ?? v).join(" / ")}). Se carga el Cliente y el resto de datos; el Soporte queda pendiente.`,
      });
    }
    if (c.hosting.candidates.length > 1) {
      out.push({
        key: `HOSTING:${c.zdId}`, kind: "HOSTING", state: "pending", title: `Servidor de «${c.name}»`, decidable: true, positions: c.positions,
        message: `Las filas de este Cliente indican servidores distintos (${c.hosting.candidates.join(" / ")}); queda pendiente.`,
      });
    }
  }
  for (const w of plan.wrike) {
    if (w.groupKeys.length > 1) {
      out.push({
        key: `WRIKE_ALIAS:${w.key}`, kind: "WRIKE_ALIAS", state: "pending", title: `Alias Wrike «${w.raw}»`, decidable: true, positions: w.positions,
        message: `Identifica varios Grupos (${names(w.groupKeys)}). No se asigna por semejanza de nombre ni se crean identidades activas solapadas.`,
      });
    } else if (w.groupKeys.length === 0) {
      out.push({
        key: `INFO:WRIKE_SIN_GRUPO:${w.key}`, kind: "INFO", state: "pending", title: `Alias Wrike «${w.raw}»`, decidable: false, positions: w.positions,
        message: "La fila no indica Grupo BC: el alias no se asigna.",
      });
    }
  }
  for (const p of plan.pap) {
    if (p.outcome === "AMBIGUOUS") {
      out.push({
        key: `PAP_ALIAS:${p.key}`, kind: "PAP_ALIAS", state: "pending", title: `Nombre PAP «${p.raw}»`, decidable: true, positions: p.positions,
        message: `Aparece con ${p.groupKeys.length} Grupos distintos (${names(p.groupKeys)}). No se corrigen grafías ni se reparte por conjetura; no se crea ninguna implantación.`,
      });
    } else if (p.outcome === "GROUP") {
      out.push({
        key: `INFO:PAP_GRUPO:${p.key}`, kind: "INFO", state: "applied", title: `Nombre PAP «${p.raw}»`, decidable: false, positions: p.positions,
        message: `Identifica ${p.clientIds.length} Clientes del Grupo ${names(p.groupKeys)}: se atribuye al Grupo (un único destino), sin crear implantaciones ficticias.`,
      });
    } else if (p.outcome === "GROUP_MISMATCH") {
      out.push({
        key: `INFO:PAP_GRUPO_DISTINTO:${p.key}`, kind: "INFO", state: "pending", title: `Nombre PAP «${p.raw}»`, decidable: false, positions: p.positions,
        message: `Su Grupo (${names(p.groupKeys)}) no coincide con el del Cliente de la fila: no se crea la implantación.`,
      });
    } else if (p.outcome === "NO_GROUP") {
      out.push({
        key: `INFO:PAP_SIN_GRUPO:${p.key}`, kind: "INFO", state: "pending", title: `Nombre PAP «${p.raw}»`, decidable: false, positions: p.positions,
        message: "La fila no indica Grupo BC: no se asigna.",
      });
    }
    if (p.outcome === "IMPLEMENTATION" && p.complexity.candidates.length > 1) {
      out.push({
        key: `INFO:PAP_TIPO:${p.key}`, kind: "INFO", state: "pending", title: `Complejidad de «${p.raw}»`, decidable: false, positions: p.positions,
        message: `Indica complejidades distintas (${p.complexity.candidates.join(" / ")}): no se asigna ninguna.`,
      });
    }
  }
  for (const p of plan.persons) {
    const label = `«${p.name}»`;
    if (p.pmo.issue) {
      out.push({
        key: `INFO:${p.pmo.issue}:${p.id}`, kind: "INFO", state: "pending", title: `PMO de ${label}`, decidable: false, positions: p.positions,
        message: PMO_ISSUE_TEXT[p.pmo.issue] ?? p.pmo.issue,
      });
    }
    if (p.level.candidates.length > 1 || p.team.candidates.length > 1) {
      out.push({
        key: `INFO:PERSONA_ATRIBUTOS:${p.id}`, kind: "INFO", state: "pending", title: `Nivel o equipo de ${label}`, decidable: false, positions: p.positions,
        message: "Las filas de esta persona dan nivel o equipo distintos: no se carga ninguno.",
      });
    }
    if (p.notes.includes("ZENDESK_DISTINTOS")) {
      out.push({
        key: `INFO:ZENDESK_DISTINTOS:${p.id}`, kind: "INFO", state: "pending", title: `Alias Zendesk de ${label}`, decidable: false, positions: p.positions,
        message: "Las dos columnas «Persona Zendesk» no coinciden: solo se carga la primera (un único alias Zendesk).",
      });
    }
    if (p.level.candidates.length === 0 || p.team.candidates.length === 0) {
      out.push({
        key: `INFO:PERSONA_INCOMPLETA:${p.id}`, kind: "INFO", state: "info", title: `Datos de ${label}`, decidable: false, positions: p.positions,
        message: `Fila incompleta (${p.level.candidates.length === 0 ? "sin nivel" : ""}${p.level.candidates.length === 0 && p.team.candidates.length === 0 ? " ni " : ""}${p.team.candidates.length === 0 ? "sin equipo" : ""}): se carga la identidad y los alias conocidos, sin equipo ni nivel inventados.`,
      });
    }
  }
  const byId = new Map(plan.persons.map((p) => [p.id, p]));
  for (const v of plan.variants) {
    const ps = v.ids.map((id) => byId.get(id)).filter((p): p is PersonPlan => !!p);
    out.push({
      key: `PERSON_VARIANT:${v.key}`, kind: "PERSON_VARIANT", state: "pending", title: `Posibles variantes: ${ps.map((p) => `«${p.name}»`).join(" y ")}`, decidable: true,
      positions: ps.flatMap((p) => p.positions),
      message: "Se cargan como personas distintas (sus correos y nombres difieren en tildes o signos). No se fusionan por semejanza: confirme si son la misma persona.",
    });
  }
  for (const e of plan.excluded) {
    out.push({
      key: `INFO:${e.code}:${e.position}`, kind: "INFO", state: "info", title: `Fila ${e.sheet ?? ""} ${e.sourceRow} excluida`, decidable: false, positions: [e.position], message: e.message,
    });
  }
  return out;
}
