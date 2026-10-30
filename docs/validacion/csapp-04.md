# Validación de CSAPP-04: Wrike, PAP y bugs de producto VFS/VSW

Registro de lo **ejecutado de verdad** en Linux. No hay pruebas en Windows/PowerShell ni aceptación manual de Dennis, y **no se ha cargado ningún archivo real**: todo se probó con archivos sintéticos pequeños generados por `tests/generators/csapp04.ts` (CSV de Wrike y bugs, XLSX de PAP), sin datos privados, archivos grandes ni secretos. Los tamaños de las medidas (≈3500 Wrike, ≈5600 PAP, VFS 82 y VSW 145) son parámetros de la prueba de volumen, no cuotas del importador, y reproducen el orden de magnitud de las fuentes de referencia, no su contenido.

## Entorno

Linux 6.18, Node 22.22.0, PostgreSQL 16.15 local (base `cs_app_test`, aislada: nombre acabado en `_test`, distinta de `cs_app`), Chromium de Playwright 1.63. Dependencias sin actualizar. Rama `claude/new-session-omvsmd` desde el main 3c08fc0c647088d2b226d1385b95e1daa8142843.

## Comandos y resultados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Sin errores (una advertencia anterior de CSAPP-03 en `scripts/e2e/casos/09-zendesk.ts`) |
| `npm run e2e:build` | Build de Next y del trabajador correctos |
| Migración limpia (`prisma migrate deploy` desde cero en cada ejecución de pruebas) y `tests/migracion-csapp04.test.ts` sobre CSAPP-03 con datos | Cuatro migraciones aplicadas; datos de Zendesk conservados (registro, decisión anterior con `targetRevision` nulo); tablas, vista `TimeActivity` y restricciones presentes; repetir el despliegue no cambia nada |
| `npm test` | **18 archivos, 274 pruebas correctas** con PostgreSQL real. Nuevas de CSAPP-04: 12 de dominio puro, 19 de Wrike y corrección sin ID, 22 de PAP y bugs y 1 de migración (54 en total) (y ajustes en las existentes de registro de perfiles, migraciones y decisiones de corrección) |
| `npm run e2e` (sobre el build final) | **162 comprobaciones correctas, 0 fallos** en Chromium sobre `next start` y el trabajador construido: 40 nuevas de CSAPP-04, una añadida al caso de Zendesk para el nuevo flujo de corrección y el resto de CSAPP-01 a 03 |
| `tests/csapp04-volumen.test.ts` (también en `npm run test:largo`) | Correcta: circuito completo de las cuatro fuentes con el trabajador real, repetición sin duplicar, recálculo y reversión |
| `tests/zendesk-volumen.test.ts` (regresión del motor compartido) | Correcta: ≈114 000 tickets y ≈250 000 tiempos (2 pruebas, 654,6 s en total) |

## Casos del prompt (§13) y su prueba

| Caso | Dónde se comprueba |
| --- | --- |
| CSV Wrike (coma, comillas, salto, 0,5 h = 30 min) | `csapp04-wrike` · «CSV Wrike y unidades»; navegador |
| ID en Wrike (216.527, cero/vacío, explícito no encontrado) | `csapp04-dominio`, `csapp04-wrike` · «ticket» |
| Ambigüedad (varios números, versión, fecha, Bug #N, conflicto proyecto–ticket) | `csapp04-dominio`, `csapp04-wrike` |
| Grupo solo | `csapp04-wrike`, `csapp04-pap-bugs` (PAP) |
| Sin imputación / horas sin fecha | `csapp04-wrike`; navegador |
| Fuente PMO (2 h + 3 h + 4 h; combinado 6 h) | `csapp04-wrike` · «política histórica»: elegibles 2 h (Zendesk dic-2024) + 4 h (Wrike ene-2025) = 6 h; las 3 h de Zendesk de ene-2025 y las de Wrike de dic-2024 quedan excluidas |
| Persona y rol | `csapp04-wrike` (PMO desconocido, no PMO, ANA/DEV por vigencia, rol no informado) |
| Corrección sin ID (Zendesk sin id y Wrike; otra fuente, inexistente, versión obsoleta, obsoleta tras decidir, un registro por fila, solo Administrador) | `csapp04-wrike` · «corrección explícita sin ID»; navegador (flujo completo de Wrike) |
| PAP identidad, multicausa, campos | `csapp04-pap-bugs` |
| Nº de BUG ambiguo y resolución tardía | `csapp04-pap-bugs` |
| VFS/VSW separados, varios años | `csapp04-pap-bugs` |
| Tipos/estados | `csapp04-pap-bugs` |
| URL y texto | `csapp04-pap-bugs` |
| Grafo (un bug–dos problemas, un problema–dos bugs no multiplican) | Parcial: los pares Work Item–ticket son únicos y los resúmenes cuentan elementos y pares distintos (`csapp04-pap-bugs`); no hay todavía agregación a indicador (el sexto indicador llega después) |
| Fotografías | `csapp04-pap-bugs` |
| Relaciones tardías | `csapp04-wrike`, `csapp04-pap-bugs` (ticket tarde, alias tarde con REDERIVE) |
| Fallos/reversión (cancelar, doble confirmación, dos trabajadores, versiones posteriores, compartidos) | `csapp04-wrike`, `csapp04-pap-bugs`; navegador (cancelar y revertir). El reinicio con SIGKILL no se repitió para estos perfiles: es del motor (CSAPP-02/03) y se mantiene sin cambios |
| UI/permisos | Navegador: circuito de los cuatro perfiles; Consulta no llega a fichas, estado, archivo ni detalle de Work Item; sin sesión, 401 |

## Medidas (Linux, este entorno; sintéticas)

Circuito completo con el trabajador real (proceso aparte, `--max-old-space-size=512`); recepción 0-0,1 s en todos los casos (lectura desde disco).

| Fuente | Filas | Archivo | Preparación | Activación | Recálculo (REDERIVE) | Pico RSS del trabajador |
| --- | --- | --- | --- | --- | --- | --- |
| Tickets de apoyo | 8 000 | 0,29 MB | 5,8 s (1 385 filas/s) | 3,4 s | 1,2 s | 263 MB |
| Wrike | 3 546 | 0,27 MB | 3,7 s (972 filas/s) | 1,2 s | 0,6 s | 263 MB |
| PAP | 5 629 | 0,26 MB | 5,5 s (1 030 filas/s) | 2,8 s | 0,3 s | 345 MB |
| Bugs VFS | 82 | 0,01 MB | 1,2 s | 0,3 s | 0,3 s | 230 MB |
| Bugs VSW | 145 | 0,01 MB | 1,2 s | 0,3 s | 0,3 s | 249 MB |
| Repetición: Wrike / PAP / VSW | 3 546 / 5 629 / 145 | ídem | 3,6 s / 6,1 s / 1,8 s | 0,9 s / 2,4 s / 0,3 s | 0,6 s / 0,3 s / 0,3 s | 270 / 349 / 243 MB |

Tras repetir, las entidades, revisiones, imputaciones y Work Items no cambian (se comprueba por conteos) y la reversión del primer lote de Wrike tarda 0,6 s y conserva lo sustentado por el repetido. Son archivos pequeños: no se extrapola a otros tamaños.

**Regresión de Zendesk a escala** (motor compartido modificado: columna `derived` en el staging, recálculo de dependientes al activar tickets y núcleo común de correcciones):

| | Tickets (114 000) | Tiempos (250 000) | Tiempos repetidos |
| --- | --- | --- | --- |
| Preparación | 69,1 s (1 649 filas/s) | 168,3 s (1 485 filas/s) | 140,0 s |
| Activación | 36,8 s | 82,6 s | 41,8 s |
| Pico RSS del trabajador | 308 MB | 329 MB | 326 MB |

Referencia de CSAPP-03 (mismo entorno, otro día): 72,5 s / 39,9 s, 166,3 s / 78,1 s y 148,7 s / 43,8 s; picos de 288, 296 y 314 MB. No hay degradación apreciable de tiempos; el pico de memoria sube ≈ 20-33 MB (la fila de staging guarda ahora un campo `derived` nulo y la activación de tickets recalcula dependientes). Lecturas de la lista de cargas durante la preparación: p95 de 8-11 ms. **No se repitió** el CSV de un millón de filas ni los reinicios con SIGKILL del motor: el camino de preparación solo añade una columna nula por fila.

## Recorrido de navegador

Resultado: 162 correctas, 0 fallos. Cubre los cuatro perfiles con web (`next start`) y trabajador construidos: subida por la interfaz, resumen, filtros por motivo, confirmación y activación, error obligatorio y cancelar, corrección sin ID (localizar, comparar, confirmación expresa rechazada sin marcar, sustitución, reversión), Reprocesar de un lote completado, repetición del archivo, PAP con revisión, bugs VFS/VSW separados, vínculos, revisión manual auditada y permisos.

## Límites y pendientes

- No probado en Windows/PowerShell; ninguna aceptación de Dennis; sin despliegue; sin cargas reales ni precarga.
- Las interpretaciones ZDT 11-13 y ZTM 06-08 siguen pendientes de aceptación (ZTM 07 se amplía; ver [decisiones](../arquitectura/wrike-pap-bugs-csapp04.md)).
- Propuestas nuevas sin aceptar por Dennis: la clave BC del grupo como forma de declarar un proyecto que solo identifica Grupo Cliente (las equivalencias Wrike/PAP del maestro no admiten grupo directo), la lista de origen de PAP como metadato obligatorio de la carga, el catálogo de etapas de estado de bugs y la lista de palabras que descartan un `#N` como ticket.
- No hay todavía agregación de «un bug–dos problemas» a indicador: solo los datos (pares únicos con tipo real del ticket).
