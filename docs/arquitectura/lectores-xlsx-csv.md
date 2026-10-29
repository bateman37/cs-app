# Lectores XLSX y CSV por bloques (CSAPP-02)

Estado: **implementado y probado en Linux** (Node 22.22.0). Contrato en `src/server/uploads/readers/types.ts`; implementación en `csv.ts`, `xlsx.ts`, `dates.ts`; punto de entrada `readRows(ruta, opciones)`, un generador asíncrono que emite una fila cada vez (memoria acotada).

## Elección y motivo

| Formato | Biblioteca (versión exacta) | Por qué |
| --- | --- | --- |
| CSV | `csv-parse` 7.0.3 (parser en streaming, con BOM, comillas RFC 4180, saltos interiores, contrapresión) | Mantenida, compatible con Node 22, no interpreta contenido |
| XLSX, contenedor | `yauzl` 3.4.0 (lectura perezosa de entradas del ZIP; valida que el tamaño real de cada entrada coincide con el declarado) | Permite fijar límites de contenido descomprimido y de relación de compresión antes de leer nada |
| XLSX, XML | `saxes` 6.0.0 (analizador XML estricto en streaming; no expande entidades externas ni DTD) | Memoria acotada, sin evaluar nada |

Se descartaron lectores que cargan el libro completo en memoria como modelo de objetos (SheetJS, ExcelJS en modo no streaming), por incumplir la memoria acotada de la entrega. Los lectores se escriben sobre estas tres piezas porque el formato SpreadsheetML necesario (celdas, cadenas compartidas, estilos de fecha, cadenas en línea) es pequeño y así se controlan los límites y los casos de exports de Power BI.

Referencias consultadas (documentación oficial y README de cada paquete incluido en `node_modules`; no se actualizó ninguna dependencia): csv-parse https://csv.js.org/parse/ ; yauzl https://github.com/thejoshwolfe/yauzl ; saxes https://github.com/lddubeau/saxes ; formato SpreadsheetML: ECMA-376 / ISO/IEC 29500, Parte 1 (apartado 18, «SpreadsheetML») https://ecma-international.org/publications-and-standards/standards/ecma-376/ . La documentación en línea no se pudo contrastar versión a versión desde la sesión; la versión usada es la de los paquetes fijados.

## Comportamiento

- **Todo es texto original**: cada celda es `{ v, k, d? }`. Un número conserva su representación exacta del archivo (los IDs largos no pasan por `Number`). `k` ∈ text, number, date, bool, error, empty. En fechas XLSX `d` lleva la fecha ISO interpretada con el calendario 1900 (con su error del 29/02/1900) o 1904 del libro; `v` conserva el serial.
- **XLSX sin `<dimension>` o con una incorrecta** (habitual en exports de Power BI): se ignora; se leen las filas realmente presentes. Probado.
- **Fórmulas**: se usa el valor en caché; nunca se evalúan. No se ejecutan macros, IQY ni HTML; las celdas con HTML o `=…` son texto.
- Hojas ocultas se omiten salvo que se pida la hoja por nombre. Filas totalmente vacías se omiten (el número de fila original se conserva).
- CSV: UTF-8 con o sin BOM; delimitador configurable; filas con número de columnas distinto se admiten (el perfil valida). UTF-16, binarios y un ZIP enviado como CSV se rechazan; un XLSX/ZIP o un `.xls` antiguo/cifrado enviado como XLSX se rechaza con mensaje claro.
- **El nombre del archivo no valida su contenido**: el formato se comprueba al leer (firma del archivo).

## Límites configurables (errores claros, `ReaderError.code`)

Tamaño del archivo (`LIMIT_FILE`), suma de bytes descomprimidos declarados (`LIMIT_UNCOMPRESSED`), relación descomprimido/comprimido por entrada de más de 1 MiB (`LIMIT_RATIO`), número de partes del ZIP (10 000), filas (`LIMIT_ROWS`), tabla de cadenas compartidas en memoria (`LIMIT_STRINGS`) y tamaño de celda. Los valores por defecto del servidor están en la configuración del motor de cargas.

## Medición real (Linux, Node 22.22.0, contenedor de desarrollo, 29/10/2026)

`npm run benchmark:lectores` (archivos sintéticos generados en el directorio temporal, no versionados; cada formato en su propio proceso):

| Formato | Filas | Tamaño | Duración | Filas/s | RSS inicial → pico |
| --- | --- | --- | --- | --- | --- |
| CSV | 1 000 001 | 102 MB | 6,1 s | ≈165 000 | 159 → 161 MB |
| XLSX (cadenas en línea) | 500 001 | 18,1 MB | 15,9 s | ≈31 500 | 130 → 143 MB |

Solo mide la lectura (sin validación ni escritura en base de datos). El pico de memoria no crece con el tamaño. No es el benchmark exhaustivo con datos reales del roadmap (CSAPP-09). Un libro con millones de cadenas compartidas únicas sí consume memoria proporcional a esa tabla, acotada por `CSAPP_UPLOAD_MAX_SHARED_STRINGS_BYTES`.

## Pruebas

`tests/lectores.test.ts` (10 casos): BOM, comillas, comas y saltos interiores; delimitador; rechazo de binarios, UTF-16 y XLSX enviado como CSV; comillas sin cerrar; límites de filas y tamaño; XLSX sin dimensión; con dimensión ficticia y cadenas compartidas; conservación de números/IDs largos y fechas 1900/1904; fórmulas en caché y hojas ocultas; archivo no XLSX; límites de filas, descomprimido y cadenas; bomba por relación de compresión. Generadores en `tests/generators/`.
