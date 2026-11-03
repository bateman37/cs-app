"""
Lectura INDEPENDIENTE del libro CLIENTES.xlsx (XML directo con la biblioteca estándar; no usa el lector de la aplicación ni sus resolvers).

Solo la usa el ensayo manual `tests/ensayo-hotfix02.test.ts` para fabricar los valores ESPERADOS sin llamar a los helpers que se prueban. Escribe en la salida
estándar un JSON con las filas útiles (valores de las columnas A..K tal como constan) y NO se guarda ni se registra: contiene datos privados.

Uso: python3 -I lectura-independiente-clientes.py <ruta.xlsx>
"""
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COLS = "ABCDEFGHIJK"


def main(path: str) -> None:
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheets = [s.get("name") for s in wb.find("m:sheets", NS)]
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    rid = wb.find("m:sheets", NS)[0].get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    sheet = ET.fromstring(z.read("xl/" + target[rid].lstrip("/").replace("xl/", "")))
    rows = []
    for r in sheet.find("m:sheetData", NS).findall("m:row", NS):
        n = int(r.get("r"))
        cells = {}
        for c in r.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            t = c.get("t")
            v = c.find("m:v", NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is not None:
                val = v.text
            else:
                val = None
            if val is not None:
                val = unicodedata.normalize("NFC", re.sub(r"\s+", " ", val).strip())
                if val != "":
                    cells[col] = val
        rows.append((n, cells))
    header = rows[0][1]
    body = [{"row": n, **{c: cells.get(c) for c in COLS}} for n, cells in rows[1:] if cells]
    out = {"sheets": len(sheets), "headerColumns": len(header), "rows": body}
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
