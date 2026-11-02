# CSAPP-10 §5: evolución mensual de Calidad por conjuntos (validación)

Se integrará en `docs/validacion/csapp-10.md`. Registra lo **ejecutado**; sin aceptación de Dennis.

## Qué cambia

- `evolutionIn` ya no llama a `computeQuality` una vez por mes. Los hechos de **todos** los meses se leen una vez (`src/server/quality/evolution.ts`): tickets, PAP y horas agrupados por mes (`ticketFactsByPeriod`, `papFactsByPeriod`, `hourFactsByPeriod` en `facts.ts`); usuarios de los años necesarios; atributos vigentes de cada corte (`loadGroupMetaForCuts`, dos consultas); stock de cada fotografía distinta (`loadStocks`, una consulta); Client Health de la entidad de la ficha (la cohorte no lo usa); declaraciones y lotes una sola vez.
- La evaluación es `evaluateMonth` (`engine.ts`), **el mismo evaluador puro** que usan cartera y ficha (`computeQuality` lo invoca): magnitudes, referencias por percentiles con la cohorte de cada mes, pesos y colores. No hay otra fórmula.
- Misma instantánea REPEATABLE READ del llamador, misma revisión activa, mismos puntos de sincronización (`quality:after-meta/tickets/hours/stock`). Sin caché y sin reutilizar la referencia del último mes. Se conservan ceros confirmados/nulos/parciales, EXACT/última anterior, fechas y usuarios por observación, Health del mes y los seis pesos. Sigue siendo «serie recalculada con revisión activa».
- El CUM del año actual es la suma exacta de los hechos mensuales (meses contiguos y disjuntos); solo se lee aparte el año anterior.
- `SET LOCAL jit = off` en esa transacción de lectura (ver «Atribución»).
- `evolutionReferenceIn` (en `detail.ts`) conserva la ruta de 09 (un `computeQuality` por mes) **solo para pruebas y medidas**.

## Equipo y comandos

Intel Xeon 2,8 GHz, 4 vCPU, 16 GB de RAM, Linux, Node 22.22.0, PostgreSQL 16.15 local (configuración por defecto), Prisma 7.10.1, `@prisma/adapter-pg` 7.10.1, pg 8.23.1, vitest 5.0.5, tsx 4.23.15. Bases propias `cs_app_perf_test` (1 500), `cs_app_perf750_test` (750) y `cs_app_perfunit_test` (pruebas); no se tocaron `cs_app` ni `cs_app_test`.

Fixture sintética determinista de `scripts/volumen-calidad.ts` (SQL, sin azar): `npx tsx scripts/volumen-calidad.ts 1500 250000 114000` y `750 125000 57000` (116 000 / 57 000 tickets, 225 508 observaciones en seis fotografías, 250 000 / 125 000 tiempos). Medidas repetidas sin resembrar: `CSAPP_SKIP_SEED=1 CSAPP_ONLY=evol CSAPP_PROFILE=1 CSAPP_EVOLUTION_DUMP=ruta npx tsx scripts/volumen-calidad.ts …` (variables documentadas en el encabezado del script; `CSAPP_ONLY=core` mide el resto de Calidad; `CSAPP_EVOLUTION_REFERENCE=1` mide la ruta de 09). Línea base: el árbol de `676df60` (09) extraído aparte, con el mismo script. Cada invocación hace 3 repeticiones por operación (la primera, fría); la evolución se midió en **3 invocaciones** por tamaño y versión (9 medidas), con `uptime` antes de cada una.

## Evolución mensual de una ficha (config. activa con percentiles de cartera, año 2026 hasta octubre, 10 meses)

Mediana de las medianas de las 3 invocaciones y rango global (s). Sentencias con `CSAPP_COUNT_QUERIES`. RSS: pico del proceso.

| Tamaño / entidad | 09: mediana s (rango) | Nueva: mediana s (rango) | Reducción | Sentencias 09 → nueva | Pico RSS MB 09 → nueva |
| --- | --- | --- | --- | --- | --- |
| 1 500 · Grupo | 18,78 (16,36–20,58) | 7,60 (7,10–9,43) | **−60 %** | 189 → **23** | 418–505 → 404–496 |
| 1 500 · Cliente | 44,12 (37,53–47,37) | 7,72 (7,17–10,34) | **−83 %** | 199 → **24** | 393–510 → 528–611 |
| 750 · Grupo | 10,88 (8,91–11,92) | 3,18 (2,94–3,41) | **−71 %** | 189 → 23 | 411–453 → 372–421 |
| 750 · Cliente | 14,81 (13,57–18,03) | 2,91 (2,85–3,81) | **−80 %** | 199 → 24 | 416–469 → 369–491 |

Cargas (`uptime`, 1 min) antes de cada invocación: 09 a 1 500: 2,90 / 3,38 / 1,83; nueva a 1 500: 4,61 / 4,10 / 4,64 (**más ruidosa para la nueva**, es decir, desfavorable); 750: 3,61 / 3,32 / 2,58 (09) y 1,17 / 1,45 / 1,39 (nueva). Hubo otros procesos en el equipo.

Repetición con el equipo en calma (tras reinicio, carga 0,6–1,3; `CSAPP_ONLY=core`, 3 repeticiones, 1 500): 09 Grupo **15,49** (15,17–15,52) y Cliente **35,91** (35,49–37,37); nueva Grupo **5,48** (5,31–5,94) y Cliente **5,80** (5,78–5,91): **−65 % y −84 %**. Con configuración por defecto (la medida de 09): 15,18 → 5,95 s.

**Sentencias: 23–24 con 10 meses y las mismas con 750 y 1 500 entidades** (no 12×). `tests/csapp10-evolucion-paridad.test.ts` lo comprueba: igual número con 3 y con 10 meses; la referencia sí crece.

Atribución a la referencia de 09 con el árbol nuevo (1 500, Grupo, carga 4,1): por mes con `computeQuality` 18,42 s; con JIT desactivado 15,33 s; por conjuntos 7,54 s. Es decir, el JIT aporta ≈ 3 s de los ≈ 11 s ahorrados y el resto procede de dejar de repetir el cálculo por mes.

### Atribución del coste (`EXPLAIN (ANALYZE, BUFFERS)`, solo bases de prueba)

Con 09 el 96 % del tiempo es SQL: tickets por mes 7,5 s (Grupo) / 29 s (Cliente) en 12 consultas, stock 4,8 s en 6, lotes 1,3 s en 10 (se releen en cada mes), horas 0,8 s, PAP 0,7 s, usuarios 0,5 s. La consulta anual de tickets por conjuntos pasó de 5,9 s a 2,3 s al desactivar JIT (3,5 s de compilación JIT: generación, inlining, optimización y emisión), y la de horas de 2,7 s a 1,0 s: su coste estimado es alto y PostgreSQL la compila. El resto es resolución real de organización → cliente → grupo por ticket (≈ 1,7 s, `ExternalIdentity_no_overlap` y `ServiceTerm`), inherente a la vista de tickets. No se ha añadido ningún índice ni migración; no creo imprescindible ninguno.

## Cartera, ficha y detalles (no empeoran > 20 %), 1 500 entidades, equipo en calma

| Operación | 09: mediana s (rango) | Nueva: mediana s (rango) | Sentencias |
| --- | --- | --- | --- |
| Cartera Grupo Cliente | 3,05 (2,88–13,44; 1.ª fría) | 2,97 (2,91–2,99) | 23 → 23 |
| Cartera Cliente | 4,44 (4,37–5,32) | 4,52 (4,32–4,93) | 24 → 24 |
| Filtro por color y orden | 2,79 (2,77–3,10) | 2,95 (2,84–3,01) | 23 → 23 |
| Ficha | 2,88 (2,85–3,09) | 2,76 (2,72–2,76) | 23 → 23 |
| Backlog histórico | 4,01 (3,96–4,01) | 4,00 (3,73–4,07) | 9 → 9 |
| Backlog con foto anterior | 1,03 (1,01–1,17) | 1,09 (1,07–1,15) | 9 → 9 |
| Diagnóstico por origen | 0,63 (0,60–0,69) | 0,72 (0,67–0,82) | 8 → 8 |
| Detalle de una familia | 0,54 (0,53–0,56) | 0,61 (0,61–0,65) | 6 → 6 |
| CSV de la cartera | 2,89 (2,80–2,97) | 2,77 (2,70–2,79) | 23 → 23 |

Mayor variación: diagnóstico +14 %, detalle +13 % (décimas de segundo, no tocan código modificado: ruido). Con el equipo cargado (otra pasada, cargas 3–4,7) aparecieron diferencias de hasta +25 % en operaciones cuyo código no cambió (backlog, diagnóstico), lo que confirma que esa pasada era ruido; se repitió en calma. Con 750 (carga 1,2–2,1): cartera 1,49 vs 1,49 s, ficha 1,64 vs 1,34 s, CSV 1,58 vs 1,29 s. **Pulse no se midió** (`volumen-pulse.ts` resiembra la base y no se ejecutó); su único cambio es que `loadGroupMeta` hace sus dos lecturas en secuencia en vez de `Promise.all`, con la misma construcción. **RSS**: pico del proceso del benchmark completo 522 → 631 MB (+21 %) con 1 500, por mantener los hechos de todos los meses a la vez.

## Paridad verificada

- `tests/csapp10-evolucion-paridad.test.ts` (27 pruebas): para 20 casos compara `evolutionIn` con `evolutionReferenceIn` en la **misma transacción** y exige igualdad profunda de toda la salida (valores, estados, colores, percentiles, `sampleN`/`cuts`, numeradores, denominadores, desglose, notas, cobertura, componentes, global, backlog, usuarios, CUM, `series.reference` y sello). Casos: mes sin cobertura (enero), cero confirmado de tickets, usuarios nulos y cero, usuarios sin informar, fotografía exacta y anterior (45 días, a mitad de mes), borrador simulado vs publicado (Grupo y Cliente), entidad Grupo y Cliente, cohorte menor que la muestra mínima, referencia por criterios con atributos vigentes por fecha, Health fechado tras el corte, último mes con corte a mitad de mes, mes en curso limitado por hoy, primer mes, mes futuro, revisión concreta de Calidad, entidad inexistente. Más aserciones de que la comparación no es vacía y la prueba de sentencias.
- **Referencia con el código de 09 real**: antes de tocar nada se volcó la salida íntegra de `evolutionIn` de 09 sobre la fixture (`tests/calidad-evolucion-fixture.ts`, semilla `20261102`) a un JSON fuera de Git, y se comparó con la de la nueva implementación: **idéntica** salvo `series.stamp`/`reference` (dependen de ids aleatorios al reconstruir la base). Igual en volumen: 3 volcados de 09 contra 3 de la nueva con 1 500 y 2 con 750 (Grupo y Cliente, configuración activa): **idénticos** salvo esos dos campos.
- Pruebas existentes intactas: `tests/calidad-*.test.ts`, `csapp09-evolucion`, `csapp09-consistencia` (incluida la serie íntegramente anterior con cambios concurrentes), `pulse-servicio`, `analitica-servicios`: 9 archivos, 148 pruebas correctas. `npx tsc --noEmit` y `npx eslint src/server/quality src/server/analytics/portfolio.ts tests scripts` sin avisos. `npm test` completo: **46 archivos, 591 pruebas correctas** (09 tenía 45 y 564; se suman 27 de paridad).

## Advertencia de `pg` («Calling client.query() when the client is already executing a query»)

- **No procede del código de Calidad ni de un `Promise.all` de nuestro código.** La condición en pg 8.23.1 (`lib/client.js:779`) es «consulta nueva con la **cola** del cliente no vacía», es decir, **tres** consultas simultáneas sobre un mismo cliente (dos no la disparan; se comprobó con un cliente pg directo). Con una precarga que registra las consultas anteriores, las ejecuciones de Calidad, evolución y paridad no la emiten.
- Origen hallado (`tests/maestros.test.ts`): el intérprete de consultas de Prisma 7.10.1 ejecuta en paralelo (`interpretNode` → `Array.map`) las subconsultas de **tres relaciones hermanas** (`ClientGroup`, `Client`, `Implementation`) de un `findMany`/`include` sobre una transacción interactiva; el patrón coincide con `withTargets` de `src/server/identities.ts`. Reproducido en aislamiento: 1 relación 0 avisos, 2 relaciones 0, 3 relaciones 1 aviso. Es comportamiento de la dependencia (`@prisma/client` + `@prisma/adapter-pg`); no se actualizó nada.
- Corrección no aplicada: está fuera de los ficheros permitidos; cargar las relaciones por consultas explícitas secuenciales o reducir a dos hermanas. `relationLoadStrategy: "join"` no está disponible sin la característica en vista previa (error de validación al probarlo), no verificado.
- Lo que sí se corrigió y no era la causa: `loadGroupMeta` lanzaba sus dos consultas con `Promise.all` sobre `tx` (dos concurrentes no disparan el aviso, pero es concurrencia innecesaria sobre una conexión); ahora son secuenciales. Otros `Promise.all` de `src/server/analytics/*` sobre `tx` (`ficha.ts:87` con seis consultas, `operational.ts`, `detail.ts`) quedan fuera de alcance y podrían disparar el aviso en la cartera; no se tocaron ni se probaron.

## Lo que no se logró o no se pudo

- Pulse y los otros benchmarks (`volumen-pulse.ts`) no se ejecutaron (ver arriba).
- `SET LOCAL jit = off` solo se aplica a la evolución; la cartera y la ficha podrían beneficiarse (no medido, fuera de alcance).
- El pico de memoria sube ≈ 20 % con 1 500 entidades.
- La medida en equipo compartido es ruidosa: los rangos con 09 llegan al ±15 %; la reducción cumple el objetivo en todas las pasadas, también en la desfavorable.
- Ningún índice nuevo ni migración. Las bases `cs_app_perf*_test` son propias de esta tarea.
