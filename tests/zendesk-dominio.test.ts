import { describe, expect, it } from "vitest";
import {
  TICKET_HEADERS,
  adminDelegadaOf,
  classifyToken,
  destinationsOf,
  incidentClass,
  isAfterPmoCutoff,
  mapHeaders,
  normalizeHeader,
  parseDateCell,
  parseDateText,
  parseDecimal,
  parseExactId,
  parseHourCell,
  parseNonNegativeDecimal,
  parseTags,
  TICKET_TYPES,
} from "@/domain/zendesk";

const t = (v: string) => ({ v, k: "text" });
const num = (v: string) => ({ v, k: "number" });

describe("identificadores exactos", () => {
  it("conserva enteros largos sin pasar por flotantes", () => {
    expect(parseExactId(t("12345678901234567890"))).toEqual({ ok: true, value: "12345678901234567890" });
    expect(parseExactId(num("123456789012345"))).toEqual({ ok: true, value: "123456789012345" });
  });
  it("acepta notación científica solo si el entero es exacto", () => {
    expect(parseExactId(num("1.23456789012345E+14"))).toEqual({ ok: true, value: "123456789012345" });
    expect(parseExactId(num("1E+3"))).toEqual({ ok: true, value: "1000" });
    expect(parseExactId(num("1.2345678901234567E+16")).ok).toBe(false);
  });
  it("vacío es null y lo ilegible se rechaza sin inventar", () => {
    expect(parseExactId(undefined)).toEqual({ ok: true, value: null });
    expect(parseExactId(t("  "))).toEqual({ ok: true, value: null });
    expect(parseExactId(t("12a")).ok).toBe(false);
    expect(parseExactId({ v: "45000", k: "date", d: "2023-03-15" }).ok).toBe(false);
  });
});

describe("decimales y duraciones", () => {
  it("canonicaliza sin redondear", () => {
    expect(parseDecimal("0.083333333333333")).toBe("0.083333333333333");
    expect(parseDecimal("1.50")).toBe("1.5");
    expect(parseDecimal("007")).toBe("7");
    expect(parseDecimal("5E-1")).toBe("0.5");
    expect(parseDecimal("1,5")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
  it("cero es válido; vacío, negativo e ilegible no", () => {
    expect(parseNonNegativeDecimal(num("0"))).toEqual({ ok: true, value: "0" });
    expect(parseNonNegativeDecimal(t("")).ok).toBe(false);
    expect(parseNonNegativeDecimal(num("-1")).ok).toBe(false);
    expect(parseNonNegativeDecimal(t("1,5")).ok).toBe(false);
  });
});

describe("fechas", () => {
  it("dd/mm es día primero; nunca mes primero", () => {
    expect(parseDateText("05/03/2024")).toEqual({ ok: true, value: { date: "2024-03-05", time: null } });
    expect(parseDateText("31/12/2024")).toEqual({ ok: true, value: { date: "2024-12-31", time: null } });
    expect(parseDateText("12/31/2024").ok).toBe(false);
  });
  it("ISO con o sin hora; la zona horaria es ambigua y se rechaza", () => {
    expect(parseDateText("2024-03-05T10:20:30")).toEqual({ ok: true, value: { date: "2024-03-05", time: "10:20:30" } });
    expect(parseDateText("2024-03-05T23:30:00Z").ok).toBe(false);
    expect(parseDateText("2024-02-30").ok).toBe(false);
  });
  it("una celda de fecha de Excel usa su fecha ya resuelta; un número sin formato no es fecha", () => {
    expect(parseDateCell({ v: "45356", k: "date", d: "2024-03-05" })).toEqual({ ok: true, value: { date: "2024-03-05", time: null } });
    expect(parseDateCell(num("45356")).ok).toBe(false);
  });
});

describe("hora del registro (no es duración)", () => {
  it("fracción de Excel, celda de hora y texto", () => {
    expect(parseHourCell({ v: "0.3506944444444444", k: "date", d: "1899-12-31T08:25:00" })).toEqual({ value: "08:25:00", readable: true });
    expect(parseHourCell(num("0.3506944444444444"))).toEqual({ value: "08:25:00", readable: true });
    expect(parseHourCell(t("8:25"))).toEqual({ value: "08:25:00", readable: true });
    expect(parseHourCell(undefined)).toEqual({ value: null, readable: true });
    expect(parseHourCell(t("mañana")).readable).toBe(false);
  });
});

describe("tags, destinos y clasificaciones", () => {
  it("array JSON como conjunto: orden y repetidos no cambian el resultado", () => {
    expect(parseTags('["b","a","a"]')).toEqual({ ok: true, value: ["a", "b"] });
    expect(parseTags("[]")).toEqual({ ok: true, value: [] });
    expect(parseTags("a,b").ok).toBe(false);
    expect(parseTags('["a",1]').ok).toBe(false);
    expect(parseTags("").ok).toBe(false);
  });
  it("destinos por tag exacto; subcadenas no cuentan; PMO+IT comparten unión N3", () => {
    expect(destinationsOf(["team_n3_pmo", "team_it"])).toEqual(["IT_N3", "PMO_N3"]);
    expect(destinationsOf(["team_n3_pmo_extra", "xteam_n2", "team_plataforma", "team_plataformavfs"])).toEqual(["VFS_N4"]);
  });
  it("tokens desconocidos no se convierten en otro", () => {
    expect(classifyToken("Open", ["open"])).toBe("open");
    expect(classifyToken("archived", ["open"])).toBeNull();
    expect(classifyToken("incident", TICKET_TYPES)).toBe("incident");
  });
  it("Admin delegada por cadena sin distinguir mayúsculas; sin dato es desconocido", () => {
    expect(adminDelegadaOf("Producción · ADMIN DELEGADA")).toBe(true);
    expect(adminDelegadaOf("Producción")).toBe(false);
    expect(adminDelegadaOf(null)).toBeNull();
  });
  it("Incidente Vincle: causas exactas e infraestructura solo con CLOUD", () => {
    expect(incidentClass("incidente_estándar_plataforma", null)).toBe("INCIDENTE_VINCLE");
    expect(incidentClass("incidente_integración/procesos", "OP")).toBe("INCIDENTE_VINCLE");
    expect(incidentClass("incidente_infraestructura", "CLOUD")).toBe("INCIDENTE_VINCLE");
    expect(incidentClass("incidente_infraestructura", "OP")).toBe("NO_INCIDENTE_VINCLE");
    expect(incidentClass("incidente_infraestructura", null)).toBe("PENDIENTE");
    expect(incidentClass("Sistemas del Cliente", "CLOUD")).toBe("NO_INCIDENTE_VINCLE");
    expect(incidentClass("Uso Indebido", null)).toBe("NO_INCIDENTE_VINCLE");
    expect(incidentClass(null, "CLOUD")).toBe("PENDIENTE");
  });
});

describe("cabeceras", () => {
  it("orden libre y normalización limitada (espacios, Unicode, mayúsculas) sin confundir campos", () => {
    const row = ["status", "  type ", "fecha_creación", "tags", "CAUSARAIZ(AGR)", "entorno  y tipología", "organization_id", "ticket_id", "otra"];
    const m = mapHeaders(row, TICKET_HEADERS);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.index.ticket_id).toBe(7);
      expect(m.index["fecha_creación"]).toBe(2);
      expect(m.extras).toEqual(["otra"]);
    }
  });
  it("no quita acentos: fecha_creacion no es fecha_creación", () => {
    const m = mapHeaders(["ticket_id", "organization_id", "Entorno y Tipología", "CausaRaiz(Agr)", "tags", "fecha_creacion", "type", "status"], TICKET_HEADERS);
    expect(m.ok).toBe(false);
  });
  it("detecta faltantes y duplicadas", () => {
    const miss = mapHeaders(["ticket_id", "tags", "type"], TICKET_HEADERS);
    expect(!miss.ok && miss.missing).toContain("status");
    const dup = mapHeaders([...TICKET_HEADERS, "Tags"], TICKET_HEADERS);
    expect(!dup.ok && dup.duplicated.length).toBe(1);
    expect(normalizeHeader("﻿Ticket_ID")).toBe("ticket_id");
  });
});

describe("corte PMO", () => {
  it("es por fecha de trabajo", () => {
    expect(isAfterPmoCutoff("2024-12-31")).toBe(false);
    expect(isAfterPmoCutoff("2025-01-01")).toBe(true);
  });
});
