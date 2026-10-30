import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRows, ReaderError, type ReaderLimits, type SourceRow } from "@/server/uploads/readers";
import { serialToIso } from "@/server/uploads/readers/dates";
import { writeCsv } from "./generators/csv";
import { writeXlsx } from "./generators/xlsx";

const LIMITS: ReaderLimits = {
  maxFileBytes: 50_000_000,
  maxUncompressedBytes: 500_000_000,
  maxCompressionRatio: 200,
  maxRows: 1_000_000,
  maxSharedStringsBytes: 50_000_000,
};

let dir: string;
beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), "csapp-lect-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function all(file: string, format: "csv" | "xlsx", limits = LIMITS, extra: object = {}): Promise<SourceRow[]> {
  const out: SourceRow[] = [];
  for await (const r of readRows(file, { format, limits, ...extra })) out.push(r);
  return out;
}
const texts = (r: SourceRow) => r.cells.map((c) => c.v);

describe("lector CSV", () => {
  it("respeta BOM UTF-8, comillas, comas y saltos de línea interiores", async () => {
    const f = path.join(dir, "a.csv");
    await writeFile(f, "﻿id,nombre,nota\r\n1,\"Pérez, Ana\",\"línea 1\nlínea 2\"\r\n2,\"dice \"\"hola\"\"\",\r\n\r\n3,Ñandú,=SUMA(A1)\r\n");
    const rows = await all(f, "csv");
    expect(texts(rows[0])).toEqual(["id", "nombre", "nota"]);
    expect(texts(rows[1])).toEqual(["1", "Pérez, Ana", "línea 1\nlínea 2"]);
    expect(texts(rows[2])).toEqual(["2", 'dice "hola"', ""]);
    expect(rows[2].cells[2].k).toBe("empty");
    // La fórmula es solo texto: no se evalúa.
    expect(texts(rows[3])).toEqual(["3", "Ñandú", "=SUMA(A1)"]);
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4]);
  });

  it("admite otro delimitador y filas con número de columnas distinto", async () => {
    const f = path.join(dir, "b.csv");
    await writeFile(f, "a;b;c\n1;2\n3;4;5;6\n");
    const rows = await all(f, "csv", LIMITS, { delimiter: ";" });
    expect(rows.map((r) => r.cells.length)).toEqual([3, 2, 4]);
  });

  it("rechaza un XLSX enviado como CSV, binarios y UTF-16", async () => {
    const x = path.join(dir, "x.xlsx");
    await writeXlsx(x, { sheets: [{ name: "H", rows: [["a"]] }] });
    await expect(all(x, "csv")).rejects.toMatchObject({ code: "FORMAT" });
    const bin = path.join(dir, "bin.csv");
    await writeFile(bin, Buffer.from([0x61, 0x2c, 0x00, 0x62, 0x0a]));
    await expect(all(bin, "csv")).rejects.toMatchObject({ code: "FORMAT" });
    const u16 = path.join(dir, "u16.csv");
    await writeFile(u16, Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    await expect(all(u16, "csv")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("rechaza comillas sin cerrar y respeta los límites de filas y de tamaño", async () => {
    const f = path.join(dir, "bad.csv");
    await writeFile(f, 'a,b\n1,"sin cerrar\n2,3\n');
    await expect(all(f, "csv")).rejects.toBeInstanceOf(ReaderError);
    const g = path.join(dir, "many.csv");
    await writeCsv(g, (function* () { for (let i = 0; i < 50; i++) yield [String(i)]; })());
    await expect(all(g, "csv", { ...LIMITS, maxRows: 10 })).rejects.toMatchObject({ code: "LIMIT_ROWS" });
    await expect(all(g, "csv", { ...LIMITS, maxFileBytes: 10 })).rejects.toMatchObject({ code: "LIMIT_FILE" });
  });
});

describe("lector XLSX", () => {
  it("lee cabeceras y hojas válidas sin <dimension> (como un export de Power BI)", async () => {
    const f = path.join(dir, "nodim.xlsx");
    await writeXlsx(f, { dimension: false, sheets: [{ name: "Datos", rows: [["id", "nombre", "importe"], ["9007199254740993", "Ñu & <b>", 12.5], [null, "sin id", 0]] }] });
    const rows = await all(f, "xlsx");
    expect(rows).toHaveLength(3);
    expect(rows[0].sheet).toBe("Datos");
    expect(texts(rows[1])).toEqual(["9007199254740993", "Ñu & <b>", "12.5"]);
    expect(rows[2].cells[0].k).toBe("empty");
    expect(rows[2].cells[1].v).toBe("sin id");
  });

  it("también lee con <dimension> ficticia y con cadenas compartidas", async () => {
    const f = path.join(dir, "sst.xlsx");
    await writeXlsx(f, { dimension: true, sharedStrings: true, sheets: [{ name: "S", rows: [["a", "b"], ["a", "c"]] }] });
    expect((await all(f, "xlsx")).map(texts)).toEqual([["a", "b"], ["a", "c"]]);
  });

  it("conserva el texto original de los números y convierte fechas con el calendario del libro", async () => {
    const f = path.join(dir, "dates.xlsx");
    await writeXlsx(f, { sheets: [{ name: "F", rows: [["f"], [{ date: 46000 }], [{ date: 46000.5 }]] }] });
    const rows = await all(f, "xlsx");
    expect(rows[1].cells[0]).toMatchObject({ v: "46000", k: "date", d: "2025-12-09" });
    expect(rows[2].cells[0].d).toBe("2025-12-09T12:00:00");
    const g = path.join(dir, "d1904.xlsx");
    await writeXlsx(g, { date1904: true, sheets: [{ name: "F", rows: [[{ date: 0 }]] }] });
    expect((await all(g, "xlsx"))[0].cells[0].d).toBe("1904-01-01");
    expect(serialToIso("61", false)).toBe("1900-03-01");
    expect(serialToIso("1", false)).toBe("1900-01-01");
  });

  it("no evalúa fórmulas (usa el valor en caché) y omite hojas ocultas", async () => {
    const f = path.join(dir, "f.xlsx");
    await writeXlsx(f, { withFormula: true, sheets: [{ name: "V", rows: [["a"], ["1"]] }, { name: "Oculta", hidden: true, rows: [["secreto"]] }] });
    const rows = await all(f, "xlsx");
    expect(rows.every((r) => r.sheet === "V")).toBe(true);
    expect(rows[1].cells[1].v).toBe("3");
    expect((await all(f, "xlsx", LIMITS, { sheet: "Oculta" }))[0].cells[0].v).toBe("secreto");
    await expect(all(f, "xlsx", LIMITS, { sheet: "Nada" })).rejects.toMatchObject({ code: "FORMAT" });
  });

  it("rechaza archivos que no son XLSX, ZIP sin libro y los que superan los límites", async () => {
    const txt = path.join(dir, "no.xlsx");
    await writeFile(txt, "esto no es un libro");
    await expect(all(txt, "xlsx")).rejects.toMatchObject({ code: "FORMAT" });
    const f = path.join(dir, "lim.xlsx");
    await writeXlsx(f, { sheets: [{ name: "S", rows: Array.from({ length: 20 }, (_, i) => [String(i)]) }] });
    await expect(all(f, "xlsx", { ...LIMITS, maxRows: 5 })).rejects.toMatchObject({ code: "LIMIT_ROWS" });
    await expect(all(f, "xlsx", { ...LIMITS, maxUncompressedBytes: 100 })).rejects.toMatchObject({ code: "LIMIT_UNCOMPRESSED" });
    const g = path.join(dir, "sst2.xlsx");
    await writeXlsx(g, { sharedStrings: true, sheets: [{ name: "S", rows: [["x".repeat(1000)]] }] });
    await expect(all(g, "xlsx", { ...LIMITS, maxSharedStringsBytes: 100 })).rejects.toMatchObject({ code: "LIMIT_STRINGS" });
  });

  it("detecta una bomba de compresión por la relación declarada", async () => {
    const f = path.join(dir, "bomb.xlsx");
    await writeXlsx(f, { sheets: [{ name: "S", rows: Array.from({ length: 60000 }, () => ["a".repeat(100)]) }] });
    await expect(all(f, "xlsx", { ...LIMITS, maxCompressionRatio: 2 })).rejects.toMatchObject({ code: "LIMIT_RATIO" });
  });
});
