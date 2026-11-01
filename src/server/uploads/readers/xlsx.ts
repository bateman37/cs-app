import { stat, open } from "node:fs/promises";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import yauzl from "yauzl";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { isDateFormat, serialToIso } from "./dates";
import { ReaderError, type Cell, type ReaderLimits, type ReaderOptions, type SourceRow } from "./types";

/**
 * Lector XLSX por bloques (SpreadsheetML, ECMA-376 / ISO 29500).
 *  - ZIP con yauzl (lectura perezosa de entradas; valida que los tamaños declarados coinciden con los reales).
 *  - XML con saxes (analizador en streaming; no expande entidades externas ni DTD).
 *  - Ignora la `<dimension>` de la hoja: lee las filas realmente presentes (los exports de Power BI suelen
 *    omitirla o darla incorrecta). Usa el valor en caché de las fórmulas; nunca las evalúa. No ejecuta macros.
 *  - Memoria: solo se conserva la tabla de cadenas compartidas (con tope) y los estilos; las filas se emiten una a una.
 *  - Las filas completamente vacías se omiten; el número de fila original se conserva.
 */

const MAX_ENTRIES = 10_000;
const MAX_SMALL_PART = 32 * 1024 * 1024;
const MAX_CELL_CHARS = 131_072;

function local(name: string): string {
  const i = name.indexOf(":");
  return i < 0 ? name : name.slice(i + 1);
}

function attr(tag: SaxesTagPlain, name: string): string | undefined {
  for (const [k, v] of Object.entries(tag.attributes)) if (local(k) === name) return v as string;
  return undefined;
}

function relId(tag: SaxesTagPlain): string | undefined {
  for (const [k, v] of Object.entries(tag.attributes)) if (k.endsWith(":id") || k === "id") return v as string;
  return undefined;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true }, (err, zip) => {
      if (err || !zip) reject(new ReaderError("El archivo no es un libro XLSX válido (ZIP dañado).", "CORRUPT"));
      else resolve(zip);
    });
  });
}

function listEntries(zip: yauzl.ZipFile, limits: ReaderLimits): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    let total = 0;
    zip.on("error", () => reject(new ReaderError("El archivo no es un libro XLSX válido (ZIP dañado).", "CORRUPT")));
    zip.on("entry", (e: yauzl.Entry) => {
      if (entries.size >= MAX_ENTRIES) return reject(new ReaderError("El libro contiene demasiadas partes.", "LIMIT_UNCOMPRESSED"));
      if (e.isEncrypted()) return reject(new ReaderError("El libro está cifrado; no se puede leer.", "UNSUPPORTED"));
      total += e.uncompressedSize;
      if (total > limits.maxUncompressedBytes) {
        return reject(new ReaderError("El contenido descomprimido del libro supera el máximo permitido.", "LIMIT_UNCOMPRESSED"));
      }
      if (e.uncompressedSize > 1_048_576 && e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > limits.maxCompressionRatio) {
        return reject(new ReaderError("La relación de compresión del libro es sospechosa (posible bomba ZIP).", "LIMIT_RATIO"));
      }
      entries.set(e.fileName, e);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.readEntry();
  });
}

function entryStream(zip: yauzl.ZipFile, e: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(e, (err, stream) => {
      if (err || !stream) reject(new ReaderError("No se pudo leer una parte del libro XLSX.", "CORRUPT"));
      else resolve(stream);
    });
  });
}

function newParser(): SaxesParser {
  return new SaxesParser({ xmlns: false });
}

/** Alimenta un analizador con una parte completa del ZIP (partes pequeñas: libro, relaciones, estilos). */
async function parseWhole(zip: yauzl.ZipFile, e: yauzl.Entry, setup: (p: SaxesParser) => void): Promise<void> {
  if (e.uncompressedSize > MAX_SMALL_PART) throw new ReaderError("Una parte del libro es demasiado grande.", "LIMIT_UNCOMPRESSED");
  const parser = newParser();
  setup(parser);
  const dec = new StringDecoder("utf8");
  try {
    for await (const chunk of await entryStream(zip, e)) parser.write(dec.write(chunk as Buffer));
    parser.write(dec.end());
    parser.close();
  } catch (err) {
    if (err instanceof ReaderError) throw err;
    throw new ReaderError("El XML del libro está mal formado.", "CORRUPT");
  }
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

type SheetRef = { name: string; target: string };

export async function* readXlsx(path: string, opts: ReaderOptions): AsyncGenerator<SourceRow> {
  const { limits } = opts;
  const size = (await stat(path)).size;
  if (size > limits.maxFileBytes) throw new ReaderError("El archivo supera el tamaño máximo permitido.", "LIMIT_FILE");
  const fh = await open(path, "r");
  const magic = Buffer.alloc(4);
  await fh.read(magic, 0, 4, 0);
  await fh.close();
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    throw new ReaderError("El archivo no es un XLSX (formato ZIP). Un .xls antiguo o un libro con contraseña no se admite.", "FORMAT");
  }

  const zip = await openZip(path);
  try {
    const entries = await listEntries(zip, limits);
    const get = (name: string) => entries.get(name);
    const wbEntry = get("xl/workbook.xml");
    if (!wbEntry) throw new ReaderError("El archivo no contiene un libro de Excel (falta xl/workbook.xml).", "FORMAT");

    let date1904 = false;
    const sheets: { name: string; rid: string; hidden: boolean }[] = [];
    await parseWhole(zip, wbEntry, (p) => {
      p.on("opentag", (t) => {
        const n = local(t.name);
        if (n === "workbookPr") date1904 = ["1", "true"].includes(attr(t, "date1904") ?? "");
        if (n === "sheet") {
          const state = attr(t, "state");
          sheets.push({ name: attr(t, "name") ?? "", rid: relId(t) ?? "", hidden: state === "hidden" || state === "veryHidden" });
        }
      });
    });

    const rels = new Map<string, { target: string; type: string }>();
    const relEntry = get("xl/_rels/workbook.xml.rels");
    if (relEntry) {
      await parseWhole(zip, relEntry, (p) => {
        p.on("opentag", (t) => {
          if (local(t.name) === "Relationship") rels.set(attr(t, "Id") ?? "", { target: attr(t, "Target") ?? "", type: attr(t, "Type") ?? "" });
        });
      });
    }
    const targets: SheetRef[] = [];
    for (const s of sheets) {
      if (opts.sheet ? s.name !== opts.sheet : s.hidden) continue;
      const r = rels.get(s.rid);
      if (!r || !r.type.endsWith("/worksheet")) continue;
      const target = r.target.startsWith("/") ? r.target.slice(1) : `xl/${r.target}`;
      targets.push({ name: s.name, target });
    }
    if (targets.length === 0) {
      throw new ReaderError(opts.sheet ? `El libro no tiene la hoja «${opts.sheet}».` : "El libro no tiene hojas visibles que leer.", "FORMAT");
    }

    // Estilos: qué índices de estilo son fechas.
    const dateStyles = new Set<number>();
    const stylesEntry = get("xl/styles.xml");
    if (stylesEntry) {
      const custom = new Map<number, string>();
      let inXfs = false;
      let xfIndex = 0;
      await parseWhole(zip, stylesEntry, (p) => {
        p.on("opentag", (t) => {
          const n = local(t.name);
          if (n === "numFmt") custom.set(Number(attr(t, "numFmtId")), attr(t, "formatCode") ?? "");
          else if (n === "cellXfs") inXfs = true;
          else if (n === "xf" && inXfs) {
            const id = Number(attr(t, "numFmtId") ?? 0);
            if (isDateFormat(id, custom.get(id))) dateStyles.add(xfIndex);
            xfIndex++;
          }
        });
        p.on("closetag", (t) => {
          if (local(t.name) === "cellXfs") inXfs = false;
        });
      });
    }

    // Cadenas compartidas (con tope de memoria).
    const strings: string[] = [];
    const sstEntry = get("xl/sharedStrings.xml");
    if (sstEntry) {
      let bytes = 0;
      let cur = "";
      let inSi = false;
      let inT = false;
      let skip = 0;
      await parseWhole(zip, sstEntry, (p) => {
        p.on("opentag", (t) => {
          const n = local(t.name);
          if (n === "si") { inSi = true; cur = ""; }
          else if (n === "rPh") skip++;
          else if (n === "t" && inSi && skip === 0) inT = true;
        });
        p.on("text", (s) => {
          if (inT) {
            cur += s;
            bytes += s.length * 2;
            if (bytes > limits.maxSharedStringsBytes) throw new ReaderError("La tabla de cadenas del libro supera el máximo permitido.", "LIMIT_STRINGS");
          }
        });
        p.on("closetag", (t) => {
          const n = local(t.name);
          if (n === "t") inT = false;
          else if (n === "rPh") skip--;
          else if (n === "si") { strings.push(cur); inSi = false; }
        });
      });
    }

    let rows = 0;
    for (const sh of targets) {
      const entry = get(sh.target);
      if (!entry) throw new ReaderError(`Falta la parte de la hoja «${sh.name}».`, "CORRUPT");
      const queue: SourceRow[] = [];
      let prevRow = 0;
      let curRow = 0;
      let cells: Cell[] = [];
      let nextCol = 0;
      let c: { col: number; t: string; s: number; v: string; inline: string; f: boolean } | null = null;
      let inV = false;
      let inIs = false;
      let inT = false;
      let inF = false;
      let skip = 0;

      const parser = newParser();
      parser.on("opentag", (t) => {
        const n = local(t.name);
        if (n === "row") {
          const r = attr(t, "r");
          curRow = r ? Number(r) : prevRow + 1;
          prevRow = curRow;
          cells = [];
          nextCol = 0;
        } else if (n === "c") {
          const r = attr(t, "r");
          const col = r ? colIndex(r) : nextCol;
          c = { col, t: attr(t, "t") ?? "n", s: Number(attr(t, "s") ?? 0), v: "", inline: "", f: false };
        } else if (n === "v") inV = true;
        else if (n === "f") {
          inF = true;
          if (c) c.f = true;
        }
        else if (n === "is") inIs = true;
        else if (n === "rPh") skip++;
        else if (n === "t" && inIs && skip === 0) inT = true;
      });
      parser.on("text", (s) => {
        if (!c || inF) return;
        if (inV) c.v += s;
        else if (inT) c.inline += s;
        if (c.v.length > MAX_CELL_CHARS || c.inline.length > MAX_CELL_CHARS) throw new ReaderError("Una celda supera el tamaño máximo permitido.", "CORRUPT");
      });
      parser.on("closetag", (t) => {
        const n = local(t.name);
        if (n === "v") inV = false;
        else if (n === "f") inF = false;
        else if (n === "is") inIs = false;
        else if (n === "rPh") skip--;
        else if (n === "t") inT = false;
        else if (n === "c" && c) {
          let cell: Cell;
          const raw = c.v;
          if (c.t === "s") {
            const text = strings[Number(raw)];
            if (text === undefined) throw new ReaderError("El libro referencia una cadena compartida inexistente.", "CORRUPT");
            cell = { v: text, k: text === "" ? "empty" : "text" };
          } else if (c.t === "inlineStr") cell = { v: c.inline, k: c.inline === "" ? "empty" : "text" };
          else if (c.t === "str") cell = { v: raw, k: raw === "" ? "empty" : "text" };
          else if (c.t === "b") cell = { v: raw, k: raw === "" ? "empty" : "bool" };
          else if (c.t === "e") cell = { v: raw, k: "error" };
          else if (c.t === "d") cell = { v: raw, k: raw === "" ? "empty" : "date", d: raw };
          else if (raw === "") cell = { v: "", k: "empty" };
          else if (dateStyles.has(c.s)) {
            const d = serialToIso(raw, date1904);
            cell = d ? { v: raw, k: "date", d } : { v: raw, k: "number" };
          } else cell = { v: raw, k: "number" };
          if (c.f) cell.f = true;
          while (cells.length < c.col) cells.push({ v: "", k: "empty" });
          cells[c.col] = cell;
          nextCol = c.col + 1;
          c = null;
        } else if (n === "row") {
          while (cells.length > 0 && cells[cells.length - 1].k === "empty" && !cells[cells.length - 1].f) cells.pop();
          if (cells.length > 0) queue.push({ sheet: sh.name, rowNumber: curRow, cells });
        }
      });

      const dec = new StringDecoder("utf8");
      let sheetDone = false;
      try {
        for await (const chunk of await entryStream(zip, entry)) {
          parser.write(dec.write(chunk as Buffer));
          while (queue.length) {
            if (++rows > limits.maxRows) throw new ReaderError("El archivo supera el número máximo de filas permitido.", "LIMIT_ROWS");
            yield queue.shift() as SourceRow;
            // Solo cabeceras: una fila por hoja y se salta al resto sin leerla.
            if (opts.headerOnly) {
              sheetDone = true;
              break;
            }
          }
          if (sheetDone) break;
        }
        if (!sheetDone) {
          parser.write(dec.end());
          parser.close();
          while (queue.length) {
            if (++rows > limits.maxRows) throw new ReaderError("El archivo supera el número máximo de filas permitido.", "LIMIT_ROWS");
            yield queue.shift() as SourceRow;
            if (opts.headerOnly) break;
          }
        }
      } catch (err) {
        if (err instanceof ReaderError) throw err;
        throw new ReaderError("El XML de una hoja está mal formado.", "CORRUPT");
      }
    }
  } finally {
    zip.close();
  }
}
