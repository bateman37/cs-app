# Validación de CSAPP-09: conciliación, rendimiento, exportaciones y recuperación

Registro de lo **ejecutado** en Linux (Node 22.22.0, PostgreSQL 16.15, Prisma 7.10.1, Playwright 1.63.0 con Chromium; 4 vCPU Intel Xeon 2,8 GHz, 16 GB de RAM; sin Windows ni PowerShell, sin lector de pantalla, sin aceptación de Dennis y **sin ningún archivo real cargado**). Separa lo **observado** (medido o comprobado), lo **implementado**, lo **propuesto** (no aceptado), lo **activado** (nada, en la base de trabajo) y lo **aceptado** (nada). Las cifras de 08 (529 pruebas, 318 comprobaciones) son de 08; aquí se repiten en la misma máquina y se indican las de 09.

## Base Git comprobada (02/11/2026)

| Referencia | SHA | Estado |
| --- | --- | --- |
| `main` | `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05; **no** contiene 06, 07 ni 08 |
| Cabeza de la PR 9 (`feature/CSAPP-08-calidad-client-health`) | `d7bc52bbf3a987ffd3691ea0ce4e9f606612001d` | CSAPP-08 |
| Cabeza de la PR 7 (`claude/new-session-omvsmd`) | `31009c99398af314a87fe3eedef5b457ede31559` | Merge de la PR 9; contiene 06, 07 y 08; **mismo contenido** que la cabeza de la PR 9 (`git diff` vacío) |
| Rama de CSAPP-09 | `feature/CSAPP-09-conciliacion-exportaciones-rendimiento` | Creada desde `31009c9`; PR **apilada contra la rama de la PR 7**; el diff contiene solo 09; sin force-push, sin tocar la historia publicada |

Comprobado con `git fetch`, `git merge-base --is-ancestor` y la lista de PR abiertas del repositorio (solo la PR 7 sigue abierta; 06–08 están integradas **en la rama de la PR 7**, no en `main`). Integración en Git no es aceptación de Dennis.

## Resultados ejecutados

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run e2e:build` | Correctos (`prisma generate` + `tsc --noEmit` sin errores; ESLint sin errores **ni advertencias**: la advertencia heredada de `09-zendesk.ts` se resolvió quitando una variable sin uso; build de Next.js y del trabajador) |
| Advertencia heredada de Vitest (`__dirname` con `configLoader: 'native'`) | Resuelta: `vitest.config.mts` usa `import.meta.dirname` |
| Advertencia heredada de `pg` («Calling client.query() when the client is already executing a query») | **Origen identificado, no corregido** (ver «Límites») |
| Base de partida (rama de 08, mismo equipo) | `npm test`: 37 archivos, 529 pruebas correctas, 416 s |
| `npm test` (09) | **45 archivos, 563 pruebas correctas**, 494 s. Nuevas: sello (1), evolución (1), consistencia con barreras (4), exportaciones (18), conciliación (4), aceptación (4), recuperación (1), migración 08→09 (2) |
| Migración | Base limpia (ocho migraciones, **sin deriva** respecto a `schema.prisma`) y actualización desde 08 con datos, `ConfigRevision` inmutable, Health y cobertura conservados, sin reset, repetible (`tests/migracion-csapp09.test.ts`) |
| Recorrido de navegador (`npm run e2e`, web y trabajador **compilados**) | **338 comprobaciones correctas, 0 fallos** (318 heredadas de 08 + 20 nuevas de `15-exportaciones.ts`). Una primera ejecución dio 320 correctas y 1 caso abortado por un defecto **del propio caso** (esperaba un mensaje que se vuelve a pintar; el fixture no era de Soporte); se corrigió el caso y se repitió el recorrido completo |
| Suites largas (`npm run test:largo`, con el trabajador real) | **7 archivos, 12 pruebas correctas, 1 555 s**: `cargas-trabajador` (SIGKILL/SIGTERM durante preparación y activación, **300 000 filas, sin reducirlo**), `cargas-volumen` (1 000 000 de filas del perfil **sintético**), `zendesk-volumen`, `csapp04-volumen`, `finanzas-trabajador`, `finanzas-volumen` y `csapp09-exportacion-trabajador` (300 000 filas). Ninguna excluida ni omitida |
| Benchmark comparado con 08 (mismo equipo, semilla y comando; 1 500 y 750 grupos) | Ver «Medidas de rendimiento»: cartera, ficha, detalles y CSV **dentro del ±15 %** de 08 con las mismas sentencias; la **evolución mensual** de una ficha pasa de 3,5 s a 15,7 s (explicado abajo); sin N+1 |

## Deficiencias de §3: reproducción, corrección y verificación

Cada una se reprodujo primero con una prueba que falla por el motivo indicado y se corrigió en el servicio compartido.

| Observado en 08 | Corrección en 09 | Prueba |
| --- | --- | --- |
| Exportaciones solo de resúmenes, con arrays/cadenas completas | Exportación completa en segundo plano (ver [arquitectura](../arquitectura/exportaciones-csapp09.md)) con trabajador, memoria acotada, progreso, descarga privada, cancelación y recuperación | `tests/csapp09-exportaciones.test.ts` (18), `tests/csapp09-exportacion-trabajador.test.ts`, caso `15-exportaciones` del recorrido |
| La evolución de Calidad no recalculaba referencias por percentiles mensuales | `evolutionIn` evalúa **cada mes con `computeQuality`** (misma evaluación que la ficha) sobre su cohorte, usuarios, cobertura, reglas y fotografía; el color de enero coincide con evaluar enero aislado (cuts 1,25/3,75, N=6) y no con la referencia de octubre (0/0) | `tests/csapp09-evolucion.test.ts` |
| `evolutionIn` convertía ausencias en 0 y elegía una foto anterior sin política | Un mes sin cobertura da **valor nulo con motivo** («cero no sustentado»); el stock sigue la política EXACT/antigüedad máxima y una foto anterior conserva fecha y carácter provisional | `tests/calidad-detalle.test.ts` (evolución), `tests/csapp09-aceptacion.test.ts` |
| CSV de Health paginaba con llamadas independientes y sello vacío | Matriz completa desde **una** instantánea con sello y fecha de lectura | `tests/calidad-detalle.test.ts` (CSV de Health) |
| El sello omitía observaciones de Work Items, punteros de observación y evidencias de vínculos | Seis omisiones demostradas (la prueba **falla con el sello de 08** y lista las mutaciones no detectadas) y corregidas; coste medido (ver abajo) | `tests/csapp09-sello.test.ts` (16 mutaciones: observación de ticket/Work Item sin cambio de contenido, punteros, evidencia, edición manual, vigencia, usuarios, servicio, tiempo, Health, cobertura, reversión, configuración) |
| Arquitectura de Calidad decía que Pulse no adopta cobertura | Pulse **sí** usa `loadDeclarations`/`coverageOf` (`src/server/pulse/service.ts`); documento corregido y distinción cero sustentado / parcial / sin fuente conservada | [calidad-csapp08.md](../arquitectura/calidad-csapp08.md) |

**Defecto propio hallado por la prueba de volumen.** La primera ejecución con el trabajador real y 300 000 filas generó un archivo con 202 filas de menos: `ORDER BY seq` ordenaba por la columna de salida `seq::text` (orden léxico) y la paginación por `seq > último` saltaba filas. Con ≤ 9 filas el orden léxico coincide con el numérico, por eso las pruebas pequeñas pasaban. Corregido (alias distinto y `ORDER BY r.seq`), con regresión de 25 filas y bloques de 3 (`tests/csapp09-exportaciones.test.ts`) y reverificado con 250 000 y 1 000 000 de filas.

## Exportación completa: volumen, recuperación y memoria

Prueba con el **trabajador compilado** y PostgreSQL real (`tests/csapp09-exportacion-trabajador.test.ts`): filas sintéticas insertadas por SQL en la base `_test`, conjunto `horas`, bloques de 2 000 filas, lease de 2 s. Se mata con **SIGKILL durante la preparación** y **durante la generación** y un tercer trabajador completa desde la materialización.

| Filas | Archivo | Memoria del trabajador (RSS máximo muestreado) | Resultado |
| --- | --- | --- | --- |
| 250 000 | 57 712 006 B (1 archivo) | ≈ 343 MB | 3 intentos; recuento, unicidad de `(fuente, id_entrada)`, Σ minutos y SHA-256 recalculado coinciden; sin parciales |
| **1 000 000** | **230 847 598 B** (1 archivo; por debajo del límite de partición) | **≈ 340 MB** | Ídem; la prueba completa (siembra + tres trabajadores) duró 87 s |

La memoria **no crece con el tamaño** (343 MB con 250 000 filas frente a 340 MB con 1 000 000; la base es Node + Prisma + un bloque de 2 000 filas). La preparación es una transacción de lectura que inserta por conjuntos en PostgreSQL; la generación lee y escribe por bloques con contrapresión. No se midió el RSS del proceso **web** durante una descarga larga (la descarga usa `Readable.toWeb` de un stream de fichero, sin cargarlo entero; **no medido**).

## Medidas de rendimiento (mismo equipo, misma semilla y mismo comando)

**Equipo y entorno.** Intel Xeon 2,8 GHz, 4 vCPU, 16 GB de RAM, Linux, Node 22.22.0, PostgreSQL 16.15 local (configuración por defecto), Prisma 7.10.1. **Semilla y comando**: `npx tsx scripts/volumen-calidad.ts 1500 250000 114000` (y `750 125000 57000` para el segundo tamaño); fixture **sintética** determinista generada por SQL en la base `_test`: 1 500 (750) Grupos y Clientes con usuarios propios, 250 000 (125 000) tiempos, 116 000 (57 000) tickets con revisiones, 225 508 observaciones en seis fotografías, 6 000 PAP, 3 000 vínculos a bugs, 15 000 celdas de Health y cobertura declarada suficiente para calcular percentiles. La base de 08 se midió con el **mismo script** (copiado a un `git worktree` de la cabeza de 08 `d7bc52b`), en el mismo equipo y la misma base, secuencialmente (nunca en paralelo). Cada operación se mide **tres veces** (la primera es «fría») y se informa mediana y rango; las operaciones con efectos (exportación y conciliación, que no existen en 08) una vez. Son medidas de **llamada de servicio dentro del proceso** (no del recorrido web ni del lector aislado); no se extrapola capacidad productiva.

**1 500 Grupos / Clientes (tamaño mayor)**

| Operación | 08: mediana s (rango) | 09: mediana s (rango) | Sentencias 08 → 09 | Variación |
| --- | --- | --- | --- | --- |
| Cartera Grupo Cliente (1 página de 50, percentiles) | 2,88 (2,65–2,92) | 3,30 (2,75–3,53) | 23 → 23 | rangos solapados |
| Cartera Cliente (1 500 clientes) | 4,37 (4,33–4,47) | 4,21 (4,07–4,31) | 24 → 24 | −4 % |
| Filtro por color y orden por global | 2,72 (2,66–2,75) | 2,66 (2,45–2,95) | 23 → 23 | −2 % |
| Ficha de una entidad (cartera + selección) | 2,81 (2,76–2,84) | 2,87 (2,77–2,92) | 23 → 23 | +2 % |
| **Evolución mensual de una entidad** | **3,49 (3,43–3,71)** | **15,72 (15,02–15,84)** | **9 → 189** | **+350 %** (ver explicación) |
| Backlog histórico (fotografía exacta) | 3,80 (3,77–4,08) | 4,08 (4,05–4,08) | 9 → 9 | +7 % |
| Backlog de un corte con solo fotografía anterior | 1,09 (1,05–1,12) | 1,10 (1,06–1,12) | 9 → 9 | +1 % |
| Diagnóstico por origen | 0,64 (0,63–0,72) | 0,61 (0,58–0,63) | 8 → 8 | −5 % |
| Detalle de una familia | 0,58 (0,57–0,62) | 0,59 (0,57–0,68) | 6 → 6 | +2 % |
| Matriz de Client Health (1.ª página) | 0,02 | 0,02 | 6 → 6 | — |
| CSV completo de la cartera | 2,74 (2,70–2,76) | 2,90 (2,85–2,92) | 23 → 23 | +6 % |
| Sello de datos (lectura) | 0,14 (0,13–0,14) | 0,16 (0,15–0,16) | 3 → 3 | +0,02 s (+14 %) |

**750 Grupos / Clientes (tamaño menor, para detectar N+1)**

| Operación | 08 (s) | 09 (s) | Sentencias |
| --- | --- | --- | --- |
| Cartera Grupo / Cliente | 1,41 / 1,35 | 1,33 / 1,24 | 23 / 24 en ambos tamaños |
| Ficha | 1,27 | 1,26 | 23 |
| Evolución mensual | 1,35 | 7,69 | 9 → **189 en ambos tamaños** |
| Backlog histórico / Diagnóstico / CSV | 1,95 / 0,34 / 1,25 | 2,05 / 0,31 / 1,33 | 9 / 8 / 23 |
| Sello de datos | 0,08 | 0,07 | 3 |

**Sin N+1**: el número de sentencias es **idéntico** con 750 y con 1 500 entidades en todas las operaciones (también en la evolución, 189, y en la conciliación, 37); el tiempo crece con el volumen, no con el número de consultas. Dos tamaños de cartera cubren la detección pedida; no se afirma linealidad exacta.

**Regresión de la evolución mensual (explicada).** Es la única operación heredada con una variación superior al 20 % (3,49 → 15,72 s con 1 500 entidades; 1,35 → 7,69 s con 750). **Causa**: 08 calculaba la serie con sus propios conteos por mes (9 sentencias, sin cohorte ni referencias por percentiles) y por eso daba un resultado **incorrecto** (umbrales prestados, ceros inventados, stock sin política). 09 evalúa cada mes con la misma evaluación que la ficha (`computeQuality`: unas 19 sentencias por mes sobre **toda la cohorte**, necesarias para los percentiles de ese mes): 10 meses × ≈19 = 189 sentencias **constantes**, independientes del número de entidades, pero cada mes cuesta casi lo mismo que una cartera. No es variación del entorno (el resto de operaciones coincide con 08 en el mismo entorno). **Mitigación aplicada**: la sección se calcula en un componente aparte con `Suspense` (streaming), de modo que el resto de la ficha se muestra de inmediato y aviso de «calculando» hasta que llega la serie; el foco de evaluación (`focusIds`) evita evaluar y explicar al resto de entidades (efecto medido **pequeño**: 15,5 → 15,7 s; el coste está en las sentencias, no en el JavaScript). **No se ha reducido el dato ni la cobertura.** **Cuello de botella restante / propuesta**: hacer los hechos de los meses en una sola pasada por familia (una consulta agrupada por mes en vez de una por mes), que llevaría el coste a ≈ el de una cartera; no se hizo en 09 por riesgo sobre el evaluador común.

**Conciliación y exportación (nuevas en 09; sin comparación con 08)** — 1 500 Grupos: conciliación de los tres niveles, año hasta 31/10: **10,37 s** y 37 sentencias (750: 5,75 s). Exportación completa, **solicitud** (totales + sello): `tickets` 2,80 s / 20 sentencias, `horas` 0,33 s, `pap` 0,32 s, `bugs` 0,57 s; **preparación + generación** en el trabajador (materialización coherente + escritura del CSV): `tickets` 7,19 s (57 sentencias), `horas` 2,55 s (69), `pap` 0,50 s, `bugs` 0,74 s. Con 750: 4,08 / 1,36 / 0,26 / 0,36 s. Los tiempos separados de **preparación** y **generación** de 1 000 000 de hechos están en la sección anterior (la prueba completa duró 87 s con siembra y tres trabajadores).

**Coste del sello.** El sello de 09 añade observaciones de Work Items, punteros de observación vigente y evidencias de vínculos: **+0,02 s** (0,14 → 0,16 s) por lectura con 116 000 tickets y 225 508 observaciones, **3 sentencias** como antes, sin escaneos nuevos por entidad. Es un detector de cambios, no un certificado ni un archivo histórico, y no se ha añadido caché persistente (las medidas no la justifican; documentar clave e invalidación solo si se introdujera).

**Planes (`EXPLAIN (ANALYZE, BUFFERS)` solo en la base `_test`, 1 500 Grupos).** Archivo `tickets`: 3,57 s de ejecución; barridos secuenciales de `ZdTicket` y `ZdTicketRevision` (necesarios: el periodo cubre ≈ toda la tabla), `Index Scan` sobre `ExternalIdentity_no_overlap` y `Bitmap Heap Scan` sobre `ServiceTerm`; `horas`: 0,79 s, barrido de `ZdTimeEntry`/`WrikeTimeEntry` con el periodo de todo el año; `problemas_bugs`: 0,29 s con `WorkItemLink_ticketId_idx`; `pap`: 5,9 ms. **No se ha añadido ningún índice**: los predicados abarcan casi toda la tabla del periodo (un índice no mejoraría el plan) y los selectivos ya los usan; la migración de 09 solo crea tablas de exportación/conciliación y declara dos índices que 08 había creado a mano y faltaban en `schema.prisma`. Cuellos de botella restantes: el barrido anual de tickets/tiempos y la evolución mensual (arriba).


## Recuperación e idempotencia (§8)

| Escenario | Cobertura ejecutada |
| --- | --- |
| Interrupción de subida: ni lote activable ni archivo final incompleto; cancelar antes de activar conserva el conjunto anterior | `tests/cargas.test.ts`, `tests/cargas-limpieza.test.ts`, `tests/cargas-api.test.ts` (08 y anteriores, reejecutados en `npm test`) |
| Matar/reiniciar durante preparación, activación y reversión (cargas) | `tests/cargas-trabajador.test.ts` (SIGKILL/SIGTERM, 300 000 filas) — ver «Suites largas» |
| `REDERIVE` y reversión de tiempos/tickets | `tests/zendesk-*.test.ts`, `tests/csapp04-*.test.ts` |
| Sustitución financiera: fallo a mitad conserva todo el lote anterior o publica el nuevo; otros años/categorías intactos; revisión obsoleta rechazada al activar; revertir restaura el conjunto anterior completo; dos activaciones y activación/reversión concurrentes | `tests/finanzas-importacion.test.ts` (p. ej. «dos lotes preparados sobre A», «también se invalida una revisión…», «cadena A→B→C»), `tests/finanzas-trabajador.test.ts` — ver «Suites largas» |
| Repetir tiempos exactos no duplica; ambigüedades exigen decisión explícita; un export antiguo de tickets no pisa una observación reciente | `tests/zendesk-tiempos.test.ts`, `tests/zendesk-tickets.test.ts` |
| **Nuevo en 09.** Revertir un lote de tickets retira su sustento de observación **y de cobertura**; una revisión sustentada por otro lote sigue; el cero acreditado por el lote revertido **deja de estarlo** y el sello cambia | `tests/csapp09-recuperacion.test.ts` (importador real) |
| **Nuevo en 09.** Exportación: caída tras escribir y antes de `READY` (regenera, mismos bytes, un archivo por parte); lease vencido y trabajador antiguo (fencing); reintentos agotados (`FAILED` visible y reintentable); cancelar en cola y en ejecución; caducidad; huérfanos; actor revocado | `tests/csapp09-exportaciones.test.ts` (in-process) y `tests/csapp09-exportacion-trabajador.test.ts` (SIGKILL con el trabajador real) |
| **Nuevo en 09.** Lecturas coherentes con barreras deterministas (otro lote, usuarios, Health, cobertura y configuración cambiados mientras se lee): resultado íntegramente anterior; lectura nueva ve el posterior; vale para la cartera, la ficha y la serie de evolución | `tests/csapp09-consistencia.test.ts` |

El arnés con procesos hijo (`tests/cargas-helpers.ts`: `reapOwnWorkers` en `afterEach`/`afterAll`, ya presente desde 06) cierra el trabajador también cuando falla el prueba; el recorrido de navegador lo cierra en `finally`. El test de 300 000 filas **no** se redujo.

## Permisos y manipulación (§9)

Probado en servidor (servicio y rutas) con sin sesión, cookie falsa, Consulta y Administrador: exportación ajena (UUID no autoriza → «no encontrada»), ID de trabajo/archivo manipulado y ruta, filtros no válidos (`dataset`, fechas, `sel`, `servicio`, campo extra) sin crear nada, actor desactivado al crear y mientras espera, descarga solo de archivos listos y vigentes, Consulta sin acceso a Administración › Conciliación/Exportaciones ni a sus descargas, y Administración supervisa estados sin enlaces de descarga ajenos. El guard central de pruebas sigue en vigor: el benchmark, la siembra del trabajador real y las migraciones temporales se ejecutan solo sobre bases `_test` (`TEST_DATABASE_URL` explícita, `current_database()` comprobado en la conexión que muta). No se limpiaron las dos cuentas residuales de 06 ni se escribió nada en `cs_app`.

## Navegador y accesibilidad (§10.4)

Caso `15-exportaciones`: solicitar, sin trabajador (aviso visible), cancelar, reintentar, progreso hasta «Listo», salir y volver, **descargar y verificar el contenido** (HTTP 200, `no-store`, BOM y `;`, recuento y Σ de minutos de la fuente, SHA-256 contra el registrado y la cabecera), manifiesto, estado por API, rechazo sin sesión/cookie falsa/Consulta/UUID manipulado, supervisión, caducidad y conciliación con descargas. Accesibilidad del panel: campos con etiqueta, estado anunciado con `role="status"`, sin desplazamiento horizontal a 1440 y 390 px, botón alcanzable por teclado. **No** se ha verificado con lector de pantalla ni en Windows.

## Cargas completas por navegador/trabajador (§10.5)

Importadores **operativos** existentes, trabajador **real compilado** y PostgreSQL, ficheros sintéticos generados en streaming y no versionados. La recepción usa `receiveUpload` (la función de servidor de la ruta de subida web) y **no** el navegador con el archivo grande (**no ejecutado por navegador**: el recorrido de navegador sube archivos pequeños).

| Perfil (formato) | Filas | Archivo | Límites | Recepción | Preparación | Activación | Pico RSS trabajador | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zendesk-tiempo` (**XLSX**) | **250 000** | 12,9 MB comprimido / 163 MB descomprimido | Por defecto (200 MB; 1 GiB descomprimido; relación 200; 5 000 000 filas), sin cambios | 0,1 s | 139,4 s (1 793 filas/s) | 70,5 s | 328 MB | Lecturas de la UI durante la preparación: 276, p95 8 ms |
| `zendesk-tiempo` (XLSX), **repetición** idéntica | 250 000 | ídem | ídem | 0,1 s | 114,5 s | 29,2 s | 301 MB | Sin duplicados (aserción de la prueba); 227 lecturas, p95 8 ms |
| `zendesk-tickets` (XLSX) | 114 000 | 4,1 MB / 67,1 MB | ídem | 0,1 s | 60,4 s | 32,8 s | 292 MB | — |
| `wrike` (**CSV**) | **1 000 000** | 78,3 MB | Por defecto (200 MB); se fijó `CSAPP_UPLOAD_MAX_BYTES` a 1 GiB por precaución, no hizo falta | 0,6 s | 453,2 s (2 207 filas/s) | 241 s | 297 MB | Recálculo (`REDERIVE`) 74,2 s; 1 000 000 recibidas, 0 con error; el resumen concilia (`reconciled: true`) y `WrikeTimeEntry` = válidas − repetidas (aserciones de la prueba); repite sin duplicar y revierte; test completo 1 473 s |

Declaración: 1 000 000 de filas de Wrike son un volumen artificial (la fuente real tiene del orden de 3 500 filas); sirve para ejercitar el importador, no para estimar la carga real. El perfil sintético del motor (1 000 000 de filas, `cargas-volumen`) pasa también, pero **no** sustituye a esta prueba. Fuera del alcance medido: capacidad productiva, subida por navegador de archivos grandes y Windows.

## Conciliación real reservada a Dennis (§11)

**Pendiente de ejecución por Dennis.** No existen fuentes reales autorizadas ni cargas hechas en este entorno; no se cargó ningún archivo privado ni se rellenó nada con datos sintéticos en su base. Lo ejecutado es la **batería sintética** ([contrato](conciliacion-contrato.md)); no equivale a la conciliación real. No se registran diferencias privadas. Recorrido breve en la [guía](../plan/guia-powershell-csapp09.md).

## Límites y no ejecutado

- **Windows/PowerShell**: guía escrita, sin probar. **Lector de pantalla**: sin probar.
- **Evolución mensual de una ficha**: coste lineal en meses (un número constante de consultas por mes, **no** por entidad) y alto con carteras grandes; ver tabla de rendimiento. Propuesta pendiente: carga diferida de esa sección.
- **Puente automático Comparativa/Pulse ↔ servicio en la pantalla de conciliación**: no incluido (propuesto); la paridad se apoya en las pruebas de 06/07.
- **RSS del proceso web** durante una descarga larga: no medido.
- **Advertencia de `pg`** («Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0»): con `--trace-deprecation` la pila es `pg/lib/client.js:780 Client.query` ← `@prisma/adapter-pg/dist/index.mjs:645 PgTransaction.performIO` ← `queryRaw:595` (adaptador 7.10.1 sobre pg 8.23.1): una consulta se emite sobre el cliente de una **transacción interactiva** mientras otra sigue en curso. Aparece **una vez** en `tests/maestros.test.ts` y **ninguna** en `tests/analitica-servicios.test.ts`. No se pudo atribuir a una línea concreta de CS App (las pilas asíncronas no conservan los marcos de la aplicación) ni la corrección es local y verificable sin cambiar dependencias (stack fijado), así que **no se ha corregido**; solo es una advertencia de obsolescencia (rompería con pg 9).
- Las **calibraciones** (umbrales, referencias, mínimos de muestra, mapeo de Health, composición del global) siguen sin aceptar y sin activar; ECO 08, ZDT 11–13, ZTM 06–08, lista PAP, estados de bugs y signo de «Diferencia» **siguen pendientes**.
- No se declara restauración ni despliegue: reiniciar el trabajador en pruebas no es copia/restauración (CSAPP-10).
