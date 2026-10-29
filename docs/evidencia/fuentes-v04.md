# Evidencia v0.4: estado y VSW ampliado

Inspección local de los archivos aportados por Dennis el 29 de octubre de 2026. Lectura de contenido; no ejecuta cargas ni software de CS App. No demuestra completitud de la cartera ni fecha de extracción. Sustituye la evidencia activa de formatos anteriores; los conteos son de muestras, no valores fijos del futuro importador.

## Tickets vigentes

DATA ZENDESK TICKET_TAG_CREATED_TYPE_STATUS.xlsx: 113856 ticket_id distintos, sin duplicados idénticos; ocho columnas comprobadas: ticket_id, organization_id, Entorno y Tipología, CausaRaiz(Agr), tags, fecha_creación, type, status. Creación entre 15/09/2021 y 27/10/2026. No hay status/fecha_creación/type vacíos; 2416 organization_id vacíos. No hay fecha de resolución/cierre, problem_id o updated_at.

| Status fuente | Cantidad |
| --- | ---: |
| closed | 111990 |
| solved | 1257 |
| hold | 156 |
| pending | 38 |
| open | 415 |

Con new/open/pending/hold como activos, hay 106 incident y 306 problem en todo el export, además de task/question. Contra el maestro inspeccionado se identifican 97 incidentes y 158 problemas activos de clientes externos; 135 problemas internos; 9 incidentes y 13 problemas con organización aún sin resolver. Estos cruces son contra un maestro de ejemplo con antigüedad, no el inventario final de clientes. Una organización sin resolver no es un defecto del cliente.

## Producto

| Muestra | Filas | Bug_ | Otros tipos | Años de creación |
| --- | ---: | ---: | ---: | --- |
| VFS Creado CS (2).csv | 82 | 79 | 3 | 2024, 2025, 2026 |
| VSW Vista CS (1).csv | 145 | 128 | 17 | 2025, 2026 |

VSW tiene 45 Bug_ creados en 2025 y 83 en 2026. Estados de sus Bug_: New 65, In Progress 11, PR 21, Done (Ready for Release) 28 y Selected 3. Los cinco Done del fichero son Request. PR ha sido definido por Dennis como pendiente de crear pull request tras finalizar desarrollo en rama.

En VSW, 11 Bug_ enlazan directamente a tickets de clientes externos, 116 a internos y uno a un ticket no presente en el XLSX. Hay 17 Bug_ con URLs explícitas adicionales que apuntan a 23 tickets distintos; 20 resuelven a clientes externos del maestro y tres a organizaciones aún no resueltas. Los conjuntos de vínculos no se suman como bugs nuevos ni garantizan cobertura completa.

El VFS conserva 30 vínculos directos externos y 49 internos entre sus 79 Bug_. Ninguna fuente se ha precargado. Dennis hará ambas cargas separadas cuando estén disponibles.
