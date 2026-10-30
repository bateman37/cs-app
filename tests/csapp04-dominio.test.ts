import { describe, expect, it } from "vitest";
import { extractTicketCandidates, isUnimputedTask, mulDecimal, parseTicketField, parseWrikeHours, resolveTicketRef } from "@/domain/wrike";
import { classifyCause, correctiveState, parseCauses, parsePapTitle, parseBugRefs } from "@/domain/pap";
import { extractZendeskUrlIds, parseTicketRefList } from "@/domain/refs";
import { classifyState, isBugType, parseLocalDateTime, parseTags } from "@/domain/bugs";

const H = ["vincle.zendesk.com"];

describe("Wrike: horas, ticket y candidatos", () => {
  it("0,5 horas son 30 minutos exactos, sin dividir por 60", () => {
    const h = parseWrikeHours("0,5");
    expect(h).toEqual({ ok: true, value: "0.5" });
    expect(mulDecimal("0.5", 60)).toBe("30");
    expect(mulDecimal("0.1", 60)).toBe("6");
    expect(mulDecimal("1.75", 60)).toBe("105");
    expect(mulDecimal("0.333", 60)).toBe("19.98");
  });
  it("rechaza notaciones ambiguas o negativas y no adivina miles", () => {
    for (const bad of ["1.500", "1,500", "1.234,5", "-1", "abc", "", "1,2,3"]) expect(parseWrikeHours(bad).ok, bad).toBe(false);
    expect(parseWrikeHours("0,125")).toEqual({ ok: true, value: "0.125" });
    expect(parseWrikeHours("8").ok).toBe(true);
    expect(parseWrikeHours("2.5")).toEqual({ ok: true, value: "2.5" });
  });
  it("216.527 normaliza solo el ticket; cero y vacío son sin ticket; otras notaciones son inválidas", () => {
    expect(parseTicketField("216.527")).toEqual({ state: "VALID", id: "216527" });
    expect(parseTicketField("216527")).toEqual({ state: "VALID", id: "216527" });
    expect(parseTicketField("0")).toEqual({ state: "NONE" });
    expect(parseTicketField("")).toEqual({ state: "NONE" });
    expect(parseTicketField("216.52")).toEqual({ state: "INVALID" });
    expect(parseTicketField("abc")).toEqual({ state: "INVALID" });
  });
  it("candidatos solo con contexto inequívoco; Bug #N, fechas y versiones no son tickets", () => {
    expect(extractTicketCandidates("Bug #123456 revisar", H)).toEqual([]);
    expect(extractTicketCandidates("Bug ID #123456", H)).toEqual([]);
    expect(extractTicketCandidates("PBI #555555 y versión 2.3.45678", H)).toEqual([]);
    expect(extractTicketCandidates("Reunión 10/05/2024 sobre 20240510", H)).toEqual([]);
    expect(extractTicketCandidates("219876 - Error en facturas", H).map((c) => c.id)).toEqual(["219876"]);
    expect(extractTicketCandidates("Revisar ticket #234567", H)[0]).toMatchObject({ id: "234567", method: "PREFIX" });
    expect(extractTicketCandidates("ver https://vincle.zendesk.com/agent/tickets/345678", H)[0]).toMatchObject({ id: "345678", method: "URL" });
    expect(extractTicketCandidates("ver https://otro.zendesk.com/agent/tickets/345678", H)).toEqual([]);
    expect(extractTicketCandidates("2024-05-10 sync", H)).toEqual([]);
  });
  it("varios candidatos no eligen por posición; el explícito prevalece y se señala la contradicción", () => {
    const cands = extractTicketCandidates("ticket #111111 y ticket #222222", H);
    expect(cands.length).toBe(2);
    expect(resolveTicketRef({ state: "NONE" }, cands)).toMatchObject({ state: "AMBIGUOUS", ticketId: null });
    expect(resolveTicketRef({ state: "VALID", id: "333333" }, cands)).toMatchObject({ state: "EXPLICIT", ticketId: "333333", contradiction: true });
    expect(resolveTicketRef({ state: "NONE" }, extractTicketCandidates("#111111", H))).toMatchObject({ state: "NAME", ticketId: "111111" });
    expect(resolveTicketRef({ state: "INVALID" }, cands)).toMatchObject({ state: "EXPLICIT_INVALID", ticketId: null });
  });
  it("tarea sin imputación: sin usuario, sin fecha y cero horas", () => {
    expect(isUnimputedTask(null, "", "0")).toBe(true);
    expect(isUnimputedTask(null, "", "2")).toBe(false);
    expect(isUnimputedTask("ana", "", "0")).toBe(false);
  });
});

describe("PAP: identidad, causas y referencias", () => {
  it("el ID sale del inicio del título con o sin «ID» ni «PAP» posterior", () => {
    expect(parsePapTitle("ID 42: PAP texto")).toMatchObject({ id: "42", rest: "PAP texto" });
    expect(parsePapTitle("42: texto cambiado")).toMatchObject({ id: "42", rest: "texto cambiado" });
    expect(parsePapTitle("  id 7 : algo")).toMatchObject({ id: "7" });
    expect(parsePapTitle("PAP 42: x")).toBeNull();
    expect(parsePapTitle("texto 42: x")).toBeNull();
  });
  it("multicausa: correctivo si cualquiera lo es, tokens conservados, orden sin duplicar", () => {
    const a = parseCauses(";#Correctivo (Estándar);#Evolutivo;#");
    const b = parseCauses("Evolutivo;#Correctivo (Estándar)");
    expect(a.map((c) => c.normalized)).toEqual(b.map((c) => c.normalized));
    expect(a.length).toBe(2);
    expect(correctiveState(a)).toBe("CORRECTIVE");
    expect(a.find((c) => c.category === "CORRECTIVE")?.origin).toBe("STANDARD");
    expect(correctiveState(parseCauses("Evolutivo;#Mantenimiento"))).toBe("NON_CORRECTIVE");
    expect(correctiveState(parseCauses(""))).toBe("UNKNOWN");
    expect(correctiveState(parseCauses("Etiqueta nueva"))).toBe("UNKNOWN");
    expect(classifyCause("correctivo (nuevo tipo futuro)").category).toBe("CORRECTIVE");
    expect(classifyCause("correctivo (origen cliente)").origin).toBe("CLIENT_ORIGIN");
  });
  it("referencias a tickets: ids explícitos, listas, URLs; sin concatenar ni extraer dígitos de notas", () => {
    const r = parseTicketRefList("#123456; 234567, https://vincle.zendesk.com/agent/tickets/345678 | 123456 | nota 10/05/2024 | 12", H);
    expect(r.refs.map((x) => x.id)).toEqual(["123456", "234567", "345678"]);
    expect(r.unparsed.map((u) => u.text)).toEqual(["nota 10/05/2024", "12"]);
    expect(parseTicketRefList("123456 234567", H).refs.map((x) => x.id)).toEqual(["123456", "234567"]);
    expect(extractZendeskUrlIds('<a href="#">Ana</a> <a href="https://vincle.zendesk.com/hc/es/requests/9001">x</a> https://vincle.zendesk.com/agent/tickets/9001', H)).toHaveLength(1);
  });
  it("Nº de BUG: producto explícito se propone; un número suelto queda ambiguo", () => {
    const map = [{ product: "VFS" as const, projects: ["proyectovfs"] }];
    const r = parseBugRefs("1234; VSW-77; https://dev.azure.com/org/ProyectoVFS/_workitems/edit/55; https://dev.azure.com/org/Otro/_workitems/edit/56; abc", map);
    expect(r.refs.find((x) => x.id === "1234")).toMatchObject({ product: null });
    expect(r.refs.find((x) => x.id === "77")).toMatchObject({ product: "VSW", reason: null });
    expect(r.refs.find((x) => x.id === "55")).toMatchObject({ product: "VFS" });
    expect(r.refs.find((x) => x.id === "56")).toMatchObject({ product: null });
    expect(r.unparsed).toHaveLength(1);
  });
});

describe("Bugs: fechas locales, tipos y estados", () => {
  it("d/M/yyyy HH:mm:ss se conserva como hora local sin zona", () => {
    expect(parseLocalDateTime("5/3/2025 9:07:01")).toEqual({ ok: true, value: { local: "2025-03-05T09:07:01", date: "2025-03-05" } });
    expect(parseLocalDateTime("31/2/2025 10:00:00").ok).toBe(false);
    expect(parseLocalDateTime("2025-03-05").ok).toBe(false);
  });
  it("solo Bug_ es defecto; PR y Ready for Release no acreditan producción; un estado nuevo no se cierra", () => {
    expect(isBugType("Bug_")).toBe(true);
    expect(isBugType("Request")).toBe(false);
    expect(classifyState("PR")).toEqual({ category: "PR_PENDING", known: true });
    expect(classifyState("Done (Ready for Release)").category).toBe("READY_FOR_RELEASE");
    expect(classifyState("Done")).toEqual({ category: "PENDING_REVIEW", known: false });
    expect(classifyState("Cerrado raro").known).toBe(false);
    expect(classifyState("Removed", ["removed"]).category).toBe("TERMINAL");
    expect(parseTags("b; a; b")).toEqual(["a", "b"]);
  });
});
