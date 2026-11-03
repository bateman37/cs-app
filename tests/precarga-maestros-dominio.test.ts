import { describe, expect, it } from "vitest";
import {
  buildPlan,
  detectSheet,
  fold,
  isInternalOrg,
  nonEmployeeReason,
  rowPmo,
  termValue,
  type ClienteTyped,
  type PersonalTyped,
  type PlanRow,
  type PmoTyped,
} from "@/domain/precarga-maestros";
import { reviewCandidates } from "@/domain/precarga-maestros-revision";
import { profileLabel } from "@/server/analytics/operational";

const cli = (o: Partial<ClienteTyped>): ClienteTyped => ({
  hoja: "CLIENTES", wrike: null, wrikeGrupo: null, zdId: "1", zdNombre: "C", zdGrupo: "G", soporteE: null, servidor: null, soporteH: null, pap: null, papGrupo: null, tipo: null, ...o,
});
const per = (o: Partial<PersonalTyped>): PersonalTyped => ({ hoja: "PERSONAL", papAlias: null, zdName: null, level: null, team: null, pmo: null, pmoFormula: false, wrike: null, zdName2: null, ...o });
const pmo = (persona: string, perfil: string | null): PmoTyped => ({ hoja: "PERSONAL PMO", persona, perfil });
const rows = (typed: (ClienteTyped | PersonalTyped | PmoTyped)[]): PlanRow[] => typed.map((t, i) => ({ position: i + 1, sheet: t.hoja, sourceRow: i + 2, typed: t }));

describe("cabeceras por posición", () => {
  it("identifica cada hoja por sus cabeceras (no por el nombre de la pestaña) y tolera la errata «acutal»", () => {
    const clientes = ["organization_wrike", "GRUPO CLIENTE VINCLE", "organization_id_zendesk", "Organization_name_zendesk", "Nivel_Servicio_acutal", "GRUPO CLIENTE VINCLE", "SERVIDOR", "Nivel_Servicio_acutal", "Organization_name_PAP", "GRUPO CLIENTE VINCLE", "TIPO "];
    expect(detectSheet(clientes)).toMatchObject({ kind: "CLIENTES", extras: [] });
    expect(detectSheet(["Persona PAP", "Persona Zendesk", "Nivel", "Equipo", "PMO", "Persona Wrike", "Persona Zendesk"])).toMatchObject({ kind: "PERSONAL" });
    expect(detectSheet(["Persona", "PERFIL"])).toMatchObject({ kind: "PMO" });
    expect(detectSheet([...clientes, "Observaciones"])).toMatchObject({ kind: "CLIENTES", extras: ["observaciones"] });
  });
  it("rechaza columnas movidas: una cabecera repetida no se confunde con otra posición", () => {
    const m = detectSheet(["organization_wrike", "GRUPO CLIENTE VINCLE", "organization_name_zendesk", "organization_id_zendesk", "Nivel_Servicio_acutal", "GRUPO CLIENTE VINCLE", "SERVIDOR", "Nivel_Servicio_acutal", "Organization_name_PAP", "GRUPO CLIENTE VINCLE", "TIPO"]);
    expect(m.kind).toBeNull();
    expect(detectSheet(["Persona", "Perfil", "x"]).kind).toBe("PMO");
    expect(detectSheet(["a", "b"]).kind).toBeNull();
  });
});

describe("reglas de valor", () => {
  it("valores de servicio solo si pertenecen al catálogo fijo; el resto no se adivina", () => {
    expect(termValue("SUPPORT", "silver  on demand")).toBe("SILVER_ON_DEMAND");
    expect(termValue("HOSTING", "Cloud")).toBe("CLOUD");
    expect(termValue("COMPLEXITY", " Enterprise ")).toBe("ENTERPRISE");
    expect(termValue("SUPPORT", "Silver")).toBeUndefined();
    expect(termValue("HOSTING", "SaaS")).toBeUndefined();
  });
  it("la fórmula PMO con Equipo vacío no prueba «No PMO»; PMO=1 exige equipo PMO", () => {
    expect(rowPmo({ pmo: 0, pmoFormula: true, team: null })).toEqual({ value: null, issue: "PMO_FORMULA_SIN_EQUIPO" });
    expect(rowPmo({ pmo: 0, pmoFormula: true, team: "CS" })).toEqual({ value: false, issue: null });
    expect(rowPmo({ pmo: 1, pmoFormula: true, team: "PMO" })).toEqual({ value: true, issue: null });
    expect(rowPmo({ pmo: 1, pmoFormula: false, team: "IT" })).toEqual({ value: null, issue: "PMO_INCONSISTENTE_CON_EQUIPO" });
    expect(rowPmo({ pmo: null, pmoFormula: false, team: "PMO" })).toEqual({ value: null, issue: null });
  });
  it("internos: sin ningún Grupo y con nombre VINCLE o Test; un cliente real sin grupo no se declara interno", () => {
    expect(isInternalOrg("VINCLE BUGS", false)).toBe(true);
    expect(isInternalOrg("Test redk", false)).toBe(true);
    expect(isInternalOrg("VINCLE BUGS", true)).toBe(false);
    expect(isInternalOrg("Testimonios SA", false)).toBe(false);
    expect(isInternalOrg("Cliente real", false)).toBe(false);
  });
  it("entradas que no son empleados: marcador de blanco y usuario de prueba; un nombre parecido no se excluye", () => {
    expect(nonEmployeeReason({ papAlias: "(en.blanco)@x.test", zdName: "(en blanco)", zdName2: "(en blanco)" })?.code).toBe("PERSONAL_MARCADOR_BLANCO");
    expect(nonEmployeeReason({ papAlias: "test.user 1@x.test", zdName: "test user 1", zdName2: null })?.code).toBe("PERSONAL_ENTRADA_PRUEBA");
    expect(nonEmployeeReason({ papAlias: "tester@x.test", zdName: "Testero Perez", zdName2: null })).toBeNull();
  });
  it("«fold» (tildes y signos) solo sirve para proponer: no iguala identidades exactas", () => {
    expect(fold("Carla Trés")).toBe(fold("carla tres"));
    expect("carla trés").not.toBe("carla tres");
  });
});

describe("plan de la precarga", () => {
  it("Cliente = organización Zendesk (ID exacto); Zendesk repetido por varios PAP sigue siendo un Cliente; Grupo por la columna F", () => {
    const p = buildPlan(rows([
      cli({ zdId: "360", zdNombre: "Alfa", zdGrupo: "ALFA", wrikeGrupo: "ALFA", papGrupo: "ALFA", pap: "P1", tipo: "Basic" }),
      cli({ zdId: "360", zdNombre: "Alfa", zdGrupo: "ALFA", wrikeGrupo: "ALFA", papGrupo: "ALFA", pap: "P2", tipo: "Enterprise" }),
    ]));
    expect(p.clients).toHaveLength(1);
    expect(p.groups.map((g) => g.name)).toEqual(["ALFA"]);
    expect(p.pap.map((x) => [x.raw, x.outcome, x.complexity.value])).toEqual([["P1", "IMPLEMENTATION", "BASIC"], ["P2", "IMPLEMENTATION", "ENTERPRISE"]]);
  });
  it("alias Wrike de varios Grupos queda sin asignar; PAP de varios Clientes del mismo Grupo va al Grupo; de varios Grupos, revisión", () => {
    const p = buildPlan(rows([
      cli({ zdId: "1", zdNombre: "A1", zdGrupo: "G1", wrike: "W", wrikeGrupo: "G1", pap: "X", papGrupo: "G1" }),
      cli({ zdId: "2", zdNombre: "A2", zdGrupo: "G1", wrike: "W", wrikeGrupo: "G1", pap: "X", papGrupo: "G1" }),
      cli({ zdId: "3", zdNombre: "B1", zdGrupo: "G2", wrike: "W", wrikeGrupo: "G2", pap: "Y", papGrupo: "G2" }),
      cli({ zdId: "4", zdNombre: "C1", zdGrupo: "G3", pap: "Y", papGrupo: "G3" }),
    ]));
    expect(p.wrike.map((w) => [w.key, w.groupKeys])).toEqual([["w", ["g1", "g2"]]]);
    expect(Object.fromEntries(p.pap.map((x) => [x.key, x.outcome]))).toEqual({ x: "GROUP", y: "AMBIGUOUS" });
    const keys = reviewCandidates(p).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["WRIKE_ALIAS:w", "PAP_ALIAS:y", "INFO:PAP_GRUPO:x"]));
  });
  it("soporte coincidente en E y H se consolida; si discrepan queda pendiente; un valor no reconocido no se adivina", () => {
    const ok = buildPlan(rows([cli({ zdId: "1", soporteE: "Gold", soporteH: "gold" })]));
    expect(ok.clients[0].support).toEqual({ value: "GOLD", candidates: ["GOLD"] });
    const bad = buildPlan(rows([cli({ zdId: "1", soporteE: "Gold", soporteH: "Platinum" }), cli({ zdId: "2", soporteE: "Plata", soporteH: null })]));
    expect(bad.clients[0].support.value).toBeNull();
    expect(bad.clients[1].support).toEqual({ value: null, candidates: [] });
    expect(reviewCandidates(bad).filter((c) => c.kind === "SUPPORT").map((c) => c.key)).toEqual(["SUPPORT:1"]);
  });
  it("personas: se unen por alias exacto (nunca por parecido); las variantes con tilde se proponen como revisión, sin fusionar", () => {
    const p = buildPlan(rows([
      per({ papAlias: "a@x.test", zdName: "Ana", zdName2: "Ana", level: "N1", team: "CS", pmo: 0 }),
      per({ papAlias: "a@x.test", zdName: "Ana", zdName2: "Ana", level: "N1", team: "CS", pmo: 0, wrike: "Ana W" }),
      per({ papAlias: "t1@x.test", zdName: "Carla Tres", level: "N1", team: "CS", pmo: 0 }),
      per({ papAlias: "t2@x.test", zdName: "Carla Trés", level: "N1", team: "CS", pmo: 0 }),
    ]));
    expect(p.persons.map((x) => x.name)).toEqual(["Ana", "Carla Tres", "Carla Trés"]);
    expect(p.persons[0].wrikeAliases).toEqual(["Ana W"]);
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0].ids).toHaveLength(2);
  });
  it("fila incompleta: identidad sin equipo ni nivel inventados; contradicciones de nivel no se cargan", () => {
    const p = buildPlan(rows([per({ papAlias: "i@x.test", zdName: "Inc" }), per({ papAlias: "c@x.test", zdName: "Cont", level: "N1" }), per({ papAlias: "c@x.test", zdName: "Cont", level: "N2" })]));
    expect(p.persons[0].level.candidates).toEqual([]);
    expect(p.persons[1].level).toEqual({ value: null, candidates: ["N1", "N2"] });
  });
  it("el plan no depende del orden de las filas (misma fuente reordenada, mismas entidades)", () => {
    const a = [
      cli({ zdId: "1", zdNombre: "A", zdGrupo: "G", wrike: "W", wrikeGrupo: "G", pap: "P", papGrupo: "G", tipo: "Medium" }),
      cli({ zdId: "2", zdNombre: "B", zdGrupo: "G", wrike: "W", wrikeGrupo: "G" }),
      per({ papAlias: "x@x.test", zdName: "X", team: "PMO", level: "N3", pmo: 1, wrike: "Xw" }),
      pmo("Xw", "ANA"),
    ];
    const norm = (p: ReturnType<typeof buildPlan>) => JSON.stringify({ g: p.groups.map((x) => x.key).sort(), c: p.clients.map((x) => x.zdId).sort(), w: p.wrike.map((x) => [x.key, x.groupKeys]).sort(), pap: p.pap.map((x) => [x.key, x.outcome]).sort(), pe: p.persons.map((x) => x.name).sort(), r: p.roles.map((x) => x.key).sort() });
    expect(norm(buildPlan(rows(a)))).toBe(norm(buildPlan(rows([...a].reverse()))));
  });
});

describe("perfiles analíticos con las etiquetas reales (sin perder horas por etiquetas)", () => {
  it("CS N1, CS N2, IT N3 y Plataforma N4 coinciden con los perfiles previstos; PMO usa el rol", () => {
    expect(profileLabel({ pmo: false, team: "CS", level: "N1", role: null })).toBe("CS N1");
    expect(profileLabel({ pmo: false, team: "CS N2", level: "N2", role: null })).toBe("CS N2");
    expect(profileLabel({ pmo: false, team: "IT", level: "N3", role: null })).toBe("IT N3");
    expect(profileLabel({ pmo: false, team: "PLAT", level: "N4", role: null })).toBe("Plataforma N4");
    expect(profileLabel({ pmo: true, team: "PMO", level: "N3", role: "ana" })).toBe("PMO ANA");
    expect(profileLabel({ pmo: false, team: null, level: null, role: null })).toBe("Sin identificar");
    expect(profileLabel({ pmo: false, team: "Otro", level: "N2", role: null })).toBe("Otro N2");
  });
});
