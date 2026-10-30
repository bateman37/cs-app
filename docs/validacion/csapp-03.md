# Validación de CSAPP-03: importadores de tickets y tiempos Zendesk

Registro de lo **ejecutado de verdad** en Linux. No hay pruebas en Windows/PowerShell ni aceptación manual de Dennis, y **no se ha cargado ningún archivo real**: todo se probó con XLSX sintéticos generados en streaming por los generadores versionados (`tests/generators/zendesk.ts`), sin datos privados ni fixtures grandes en Git. Un caso definido no cuenta como probado hasta aparecer aquí.

## Entorno

Linux 6.18, Node 22.22.0, PostgreSQL 16 local (base `cs_app_test`, aislada: nombre acabado en `_test`, distinta de `cs_app`), Chromium de Playwright 1.63. Dependencias sin actualizar. Las bases de test están protegidas por nombre y por la comprobación de `TEST_DATABASE_URL` distinta de `DATABASE_URL`; ningún comando de prueba apunta a `cs_app`.

## Comandos y resultados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Sin errores |
| `npm run e2e:build` | Build de Next y del trabajador correctos |
| `npm run db:migrar` sobre base vacía (`prisma migrate deploy` desde cero en cada ejecución de pruebas) | Las tres migraciones se aplican |
| Migración sobre CSAPP-02 con datos (`tests/migracion-csapp03.test.ts`) | Datos de personas, alias, clientes y lotes conservados; tablas, valor `REDERIVE` y restricciones presentes; repetir el despliegue no cambia nada |
| `npm test` | **14 archivos, 220 pruebas correctas** con PostgreSQL real. De ellas, de Zendesk: 18 de dominio puro, 25 de tickets, 32 de tiempos, 4 de permisos y 1 de migración |
| `npm run e2e` | **121 comprobaciones correctas** en Chromium sobre `next start` y el trabajador construido (78 anteriores —CSAPP-01 y 02— más 43 de Zendesk) |
| `npm run e2e:volumen` | **7 comprobaciones correctas**: subida por el navegador de ≈114 000 tickets y ≈250 000 tiempos, activación y recálculo |
| `npm run test:largo` | Zendesk (volumen y reinicios) y CSV de un millón: correctas. `cargas-trabajador` (CSAPP-02) falló con su tamaño por defecto por agotar su espera en este entorno, más lento hoy que cuando se midió CSAPP-02; con `CSAPP_TEST_RESTART_ROWS=150000` pasan sus 3 pruebas (ver abajo) |

## Medidas (Linux, este entorno; sintéticas)

Motor completo con el trabajador real (proceso aparte, `--max-old-space-size=512`). Lecturas de la lista de cargas mientras se prepara: p95 de 10-13 ms.

| | Tickets | Tiempos | Tiempos repetidos |
| --- | --- | --- | --- |
| Filas | 114 000 | 250 000 | 250 000 |
| XLSX comprimido / descomprimido | 4,1 MB / 67,1 MB | 12,9 MB / 163 MB | ídem |
| Preparación | 72,5 s (1 570 filas/s) | 166,3 s (1 500 filas/s) | 148,7 s |
| Activación | 39,9 s | 78,1 s | 43,8 s (0 importadas: todas duplicadas) |
| Pico RSS del trabajador | 288 MB | 296 MB | 314 MB |

Límites configurados: 200 MB de subida, 1 GB descomprimido, relación 200, 5 000 000 de filas. Tiempos de **recepción** por el motor 0,1-0,2 s (lectura desde disco).

Subida **por el navegador** a `next start` (bytes reales por XHR, sin `formData`): tickets 4,1 MB en 0,5 s, tiempos 12,9 MB en 0,4 s (loopback local: no mide una red real). Preparación 68,5 s y 173,8 s; activación 38,3 s y 99,4 s. Ficha del lote: 1,5-1,9 s (tickets) y 5,2 s (tiempos preparados) o 10,8 s (tiempos completados) en cargar. Pico del trabajador 574 MB con la memoria por defecto de Node y del servidor web 305-309 MB. Recalcular (REDERIVE) un lote completado de 250 000 registros desde su ficha: 48,3 s, sin duplicar registros. Los archivos grandes de 12,9 MB superan con holgura el tamaño típico de 10 MB en el que fallan los límites de cuerpo de proxy; la ruta de subida está excluida del proxy y valida por sí misma.

**Recuperación**: con 80 000 tiempos, SIGKILL durante la preparación (el staging coincide con el checkpoint, sin duplicar posiciones y el trabajo termina con 2 intentos) y SIGKILL durante la activación (la base queda con 0 registros, nunca parcial; otro trabajador la completa con exactamente 80 000 registros, una auditoría `ACTIVATE` y un trabajo `DONE`).

**Regresión del motor**: CSV de 1 000 000 filas por el motor de CSAPP-02: preparación 432,5 s, activación 214,6 s, pico RSS 331 MB, lecturas p95 11 ms. Son más lentas que las cifras de CSAPP-02 (264 s y 153 s), pero se comprobó con un A/B directo de 200 000 filas en este entorno: `main` (CSAPP-02) 2 450 filas/s y activación 31,2 s frente a la rama 2 381 filas/s y 30,2 s. El entorno es hoy más lento; no hay regresión atribuible a la rama. `cargas-trabajador` con su tamaño por defecto (300 000) agotó su espera de 120 s en este entorno; con 150 000 filas pasan las tres pruebas (SIGKILL en preparación y activación, SIGTERM con liberación del trabajo, dos trabajadores reales).

## Hallazgos durante la validación (corregidos)

- **Planes cuadráticos a escala** (invisibles con archivos pequeños): una sentencia que lee de la tabla en la que inserta, y una derivación cara unida a un conjunto de cardinalidad desconocida, tardaban más de 6 minutos con 114 000 filas. Rediseñados (tabla temporal con `ON CONFLICT`; la derivación arrastra su carga útil) y el motor ahora hace `ANALYZE` del staging y detecta contradicciones por agregación. Ver [decisiones técnicas](../arquitectura/zendesk-csapp03.md).
- **Ficha lenta** (>30 s con 250 000 filas preparadas): la derivación se recalculaba en cada consulta. Ahora se calcula una vez al preparar/activar/recalcular, se lee indexada y un aviso indica si los maestros o tickets cambiaron después.
- **Interfaz**: tras «Revertir» la ficha no se actualizaba sola (el sondeo se detenía en estados terminales); ahora sigue mientras haya un trabajo pendiente. Detectado por la nueva prueba de navegador de Revertir.
- Trabajadores huérfanos de ejecuciones interrumpidas pueden dejar sesiones de PostgreSQL ejecutando sentencias largas: se terminaron explícitamente en la base de test antes de repetir.

## Casos de aceptación (§14 del prompt) y su prueba

| Caso | Prueba que lo ejecuta |
| --- | --- |
| Perfil de tickets antiguo | `zendesk-tickets`: «perfil antiguo sin status», «falta cualquier otra cabecera»; navegador: formato antiguo rechazado sin tocar activos |
| Fecha/ID | `zendesk-tickets`: orden variable, columnas extra, ID de 14 cifras, 1900 y 1904, dd/mm; `zendesk-tiempos`: 1900/1904 y dd/mm; `zendesk-dominio` |
| Ticket sin horas | `zendesk-tickets`; navegador (detalle del ticket sin horas) |
| Revisión | `zendesk-tickets`: open→solved crea revisión con `changedFields`, sin `solved_at` |
| Observación | `zendesk-tickets`: nueva extracción sin cambios; navegador: revisados 1 / sin cambios 1 |
| Export viejo | `zendesk-tickets`: no pisa el estado reciente; reproceso conserva la observación |
| Ausencia | `zendesk-tickets`: ticket ausente no se elimina ni se cierra |
| Tags | `zendesk-tickets` y dominio: conjunto, PMO+IT una unidad N3, subcadena no cuenta |
| Causas | `zendesk-tickets`: Sistemas del Cliente y Uso Indebido conservados; entorno y causa separados |
| Infraestructura | `zendesk-tickets`: OP, CLOUD, migración por fecha y desconocido pendiente |
| Duración | `zendesk-tiempos`: 1 h 30 min = 1,5 h; 0 h 5 min; doce de cinco minutos = 1 h exacta; precisión; hour no suma |
| Sin id | `zendesk-tiempos` |
| id reutilizado | `zendesk-tiempos` |
| Duplicado | `zendesk-tiempos`: dos lotes con ambas procedencias; solapamiento de exports |
| Corrección explícita | `zendesk-tiempos`: advertencia, sin aplicar por defecto, sustituye sin sumar, otro trabajo, reversión; sin `id` no hay revisión automática |
| Corte PMO | `zendesk-tiempos`: 2 h diciembre 2024 permitidas, 3 h enero 2025 excluidas y conservadas; pertenencia a la fecha del trabajo |
| Otros equipos | `zendesk-tiempos`: no PMO desde 2025 elegible, PMO desconocido pendiente, persona desconocida antes de 2025 no prohíbe la fuente |
| Orden de cargas | `zendesk-tiempos`: tiempos antes que tickets sin recrear ni doblar; navegador |
| Maestros | `zendesk-tiempos`: alias, equivalencia y Grupo BC completados y reprocesados; Cliente sin grupo conserva identidad; navegador |
| Reversión | `zendesk-tiempos` y `zendesk-tickets`: filas compartidas, revisiones posteriores, tiempos de otro lote intactos; navegador |
| Fallos/concurrencia | `zendesk-tiempos`: doble confirmación, dos trabajadores, fallo que revierte la activación; `zendesk-volumen`: SIGKILL |
| Browser y permisos | `09-zendesk` (recorrido de ambos perfiles y acciones Cancelar, Reprocesar, Revertir) y `zendesk-permisos` (API y acciones directas; Consulta y sin sesión) |

## Conciliaciones verificadas (con datos sintéticos de resultado conocido)

La partición contable de un lote de tiempos suma exactamente las filas y los minutos válidos (7 filas y 7,25 h en el caso del navegador; 250 000 filas en volumen, con 240 003 atribuibles, 7 496 excluidas por PMO y 2 501 sin organización). Los motivos no se suman dos veces y los indicadores no añaden horas. Tickets: distintos = nuevos + revisados + sin cambios; las observaciones igualan a los tickets distintos. Importados no cuenta duplicados ni posibles correcciones sin decidir.

## Qué no se ha probado

Windows/PowerShell; aceptación manual de Dennis; lector de pantalla; archivos reales (formato real, tamaños reales, calidad real de maestros); red real para la subida; despliegue. Las interpretaciones ZDT 11-13 y ZTM 06-08 esperan su validación.
