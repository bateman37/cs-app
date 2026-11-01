import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

/** Generador mínimo de XLSX para pruebas (SpreadsheetML válido, en streaming para archivos grandes). */
export type XlsxOptions = {
  sheets?: { name: string; rows: Iterable<(string | number | { date: number } | { raw: string } | { f: string; v?: string } | null)[]>; hidden?: boolean }[];
  /** Escribe la <dimension> de la hoja (los exports de Power BI suelen omitirla). */
  dimension?: boolean;
  /** Cadenas compartidas en vez de inlineStr (solo para archivos pequeños). */
  sharedStrings?: boolean;
  date1904?: boolean;
  /** Incluye una fórmula con valor en caché en la última columna de la primera fila de datos (no se evalúa). */
  withFormula?: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function writeXlsx(path: string, opts: XlsxOptions): Promise<void> {
  const sheets = opts.sheets ?? [];
  const zip = new yazl.ZipFile();
  const shared: string[] = [];
  const sharedIdx = new Map<string, number>();
  const sst = (s: string) => {
    let i = sharedIdx.get(s);
    if (i === undefined) { i = shared.length; shared.push(s); sharedIdx.set(s, i); }
    return i;
  };

  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`), "[Content_Types].xml");
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`), "_rels/.rels");
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${opts.date1904 ? ' date1904="1"' : ""}/><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`), "xl/workbook.xml");
  const relXml = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relXml}</Relationships>`), "xl/_rels/workbook.xml.rels");
  // Estilo 0 = General, estilo 1 = fecha (numFmt 14).
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`), "xl/styles.xml");

  sheets.forEach((sheet, si) => {
    const iter = sheet.rows[Symbol.iterator]();
    function* xml() {
      yield `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
      if (opts.dimension) yield `<dimension ref="A1:Z9999999"/>`;
      yield `<sheetData>`;
      let r = 0;
      let buf = "";
      for (let n = iter.next(); !n.done; n = iter.next()) {
        r++;
        const cells = n.value.map((c, ci) => {
          const ref = `${colName(ci)}${r}`;
          if (c === null) return "";
          if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
          if (typeof c === "object" && "raw" in c) return `<c r="${ref}"><v>${esc(c.raw)}</v></c>`;
          if (typeof c === "object" && "f" in c) return `<c r="${ref}"><f>${esc(c.f)}</f>${c.v !== undefined ? `<v>${esc(c.v)}</v>` : ""}</c>`;
          if (typeof c === "object") return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
          return opts.sharedStrings ? `<c r="${ref}" t="s"><v>${sst(c)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
        });
        if (opts.withFormula && r === 2) cells.push(`<c r="${colName(n.value.length)}${r}"><f>SUM(1,2)</f><v>3</v></c>`);
        buf += `<row r="${r}">${cells.join("")}</row>`;
        if (buf.length > 65536) { yield buf; buf = ""; }
      }
      yield buf + `</sheetData></worksheet>`;
    }
    zip.addReadStream(Readable.from(xml()), `xl/worksheets/sheet${si + 1}.xml`);
  });
  if (opts.sharedStrings) {
    // Se escribe tras generar las hojas: se difiere hasta que todas las filas se hayan consumido.
    zip.addReadStream(
      Readable.from(
        (function* () {
          yield `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`;
          for (const s of shared) yield `<si><t xml:space="preserve">${esc(s)}</t></si>`;
          yield `</sst>`;
        })(),
      ),
      "xl/sharedStrings.xml",
    );
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}
