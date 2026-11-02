# Validación técnica de CSAPP-10 (cierre, instalación, recuperación y aceptación)

Registro de lo **ejecutado** el 02/11/2026. Separa lo observado de lo implementado, de lo propuesto y de lo **no ejecutado**. La aceptación funcional y el despliegue **no** están aquí: ver el [registro de aceptación](registro-aceptacion.md). Todo se hizo con datos **sintéticos** en bases `…_test` aisladas; no se cargó ningún archivo real ni se tocó `cs_app`.

## Sistema y versiones

Linux 6.18 (Firecracker), Intel Xeon 2,8 GHz, **4 vCPU, 15 GB**, equipo compartido durante parte del trabajo (los agentes de rendimiento y de copia ejecutaron a la vez; las medidas de rendimiento declaran su carga). Node 22.22.0 · PostgreSQL 16.15 (servidor y herramientas) · Next.js 16.4.3 (Turbopack) · Prisma 7.10.1 · pg 8.23.1 · Vitest 5.0.5 · Playwright 1.63 / Chromium. Versión de aplicación 0.1.0. **Windows, PowerShell y lector de pantalla: NO ejecutados.**

## Base Git

- `main` (`f71b5b7`) incluye CSAPP-05; **no** contiene 06–09. La PR 10 (CSAPP-09) ya estaba **fusionada** en la rama de la PR 7 (`claude/new-session-omvsmd`, cabeza `676df60`). La rama de CSAPP-10 (`feature/CSAPP-10-instalacion-recuperacion-cierre`) parte de `676df60` y su PR va **apilada contra esa rama**, sin tocar la PR 7 ni la de 09. Sin force-push.
- Cambio respecto al prompt: allí la PR 10 figuraba abierta con cabeza `223b881`; al ejecutar estaba fusionada (el merge `676df60` la contiene).

## Resumen por sección del prompt

| § | Resultado | Evidencia |
| --- | --- | --- |
| 3 Instalación y arranque compilado | Hecho y ensayado en Linux | Ensayo de instalación 27/27 (abajo); catálogo de variables sincronizado (test) |
| 4 Operación, salud y parada | Hecho | 16 pruebas de salud con reloj controlado; 4 con el trabajador compilado (base perdida, almacén ausente, parada, plazo); caso de navegador |
| 5 Rendimiento de la evolución | **Cumplido** | −60 % a −84 % de mediana; 189–199 → 23–24 sentencias; paridad idéntica ([detalle](csapp-10-evolucion.md)) |
| 6 Cargas y descargas grandes por navegador | Hecho | 21/21 (abajo) |
| 7–8 Copia y restauración | Hecho y ensayado | 64 pruebas + ensayo 89/89 ([detalle](csapp-10-restauracion.md)) |
| 9 Actualización y vuelta atrás | Ensayada | Ensayo 17/17 (abajo) |
| 10 Puente de conciliación y registro de aceptación | Hecho | `REC-N4-01…06`, 5 pruebas; [registro](registro-aceptacion.md) |
| 11 Verificación final | Ver tabla de suites | |
| 12 Documentación | Hecho | README, índice, guías vigentes, históricas marcadas |

## Suites ejecutadas sobre el árbol final

| Suite | Resultado |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint` | Sin errores ni advertencias |
| `npm run build:todo` (web y trabajador) | Correcto |
| `npm test` (suite rápida) | 56 archivos, **685 pruebas** (09: 45 archivos, 564), todas correctas tras documentar las variables de copias/benchmarks (una primera pasada falló solo por esa sincronización y se corrigió) |
| `npm run e2e` (recorrido de navegador, compilado) | **359/359** (338 heredadas + 21 nuevas: Operación, salud, permisos, diagnóstico redactado, presentación a 1 440 y 390 px) |
| `npm run e2e:grandes` | **21/21** |
| `npm run ensayo:instalacion` | **27/27** |
| `npm run ensayo:actualizacion` (09 → 10 → 09 → 10) | **17/17** |
| `npm run ensayo:restauracion` (dos volúmenes) | **89/89** |
| `npm run test:largo` (300 000 filas, sin reducir) | 7 archivos, **12 pruebas correctas** (1 577 s) |

## Instalación y operación (`npm run ensayo:instalacion`, 27/27)

Base nueva, directorios con **espacios**, web y trabajador compilados, entorno de **producción mínimo** (sin variables de prueba, sin leer el `.env` del repositorio). Fases (s desde el inicio): verificar 1,7 · migrar 5,9 · preparar y cuenta 11,4 · arranque 14,2 · parada ordenada 19,7 · reinicio y parada final 24,9.

Comprobado: `verificar` sin errores y sin imprimir credenciales; secreto corto y rutas relativas son errores accionables; migrar aplica las 9 migraciones y repetir es idempotente; `preparar` enlaza los dos almacenes y repetir conserva la identidad; primer Administrador por entrada segura y repetirlo no sobrescribe la clave; supervisor registra sus tres procesos; salud pública mínima (`{status}`); el trabajador figura **«presente en reposo» sin ningún trabajo**; esquema compatible; **segundo arranque rechazado** sin afectar a la primera instancia; parada ordenada sin procesos huérfanos y el trabajador queda **«detenido»**; tras reiniciar persisten cuenta y datos; trabajador suelto late en reposo y se cierra con SIGTERM (código 0); registros con fecha, nivel e instancia.

Pruebas de operación con reloj controlado y el trabajador real: `tests/csapp10-salud.test.ts` (16) y `tests/csapp10-recuperacion-operativa.test.ts` (4: pérdida de las sesiones de base del propio trabajador, almacén de originales ausente con recuperación, parada con trabajo en curso que vuelve a la cola sin completarse, plazo de cierre agotado). En todos: error identificable, reintentos acotados, **sin duplicados ni activación parcial**.

## Actualización 09 → 10 y vuelta atrás (`npm run ensayo:actualizacion`, 17/17)

Base con **datos de 09 sembrados por el propio código de 09** (57 tablas, 48 401 filas; ocho migraciones, sin tablas de 10). Con el código de 10 y el esquema de 09 la salud avisa **«migraciones pendientes»** (y funciona con esquema incompleto). `migrate deploy` aplica solo `20261105090000_operacion_latido_instalacion`. Tras migrar, la **huella (recuento + resumen criptográfico) de cada tabla anterior es idéntica**; 10 arranca, la cuenta de 09 entra y las cuatro vistas y Administración responden 200. Leer las vistas crea de forma perezosa la revisión inicial de configuración económica (solo `EconomicSettingsRevision`, en cualquier versión).

**Vuelta atrás de código**: 09 compilado arranca sobre el esquema de 10, la cuenta entra, las cuatro vistas responden 200 y no altera ningún dato (huella idéntica); volver a 10 no deja migraciones pendientes. Tiempos: sembrado 18,9 s · actualizar 25,6 · arranque 34,6 · vuelta atrás de código 45,9. La **restauración de datos** (vuelta atrás si el esquema no fuera compatible) está ensayada en la [validación de copia y restauración](csapp-10-restauracion.md); su pérdida potencial es lo escrito entre la copia y la conmutación. Migración y esquema: `tests/migracion-csapp10.test.ts` (sobre datos de 09, solo añade dos tablas, sin deriva).

## Cargas y descargas grandes por navegador (`npm run e2e:grandes`, 21/21)

Web y trabajador **compilados**, PostgreSQL y almacenes `_test` aislados, sesión real de Chromium, control habitual de subida. Archivos sintéticos generados por streaming (6 s), fuera de Git. **Límites efectivos** por defecto (200 MB por archivo, 5 000 000 de filas): no hizo falta tocar ninguno; las rutas de subida ya están fuera del proxy de sesión. Ruta: navegador → `next start` directo (**sin proxy real: ese salto no se probó**).

| Caso | Filas / bytes | Recepción | Preparación | Activación | RSS web (mín–máx) | RSS trabajador (mín–máx) |
| --- | --- | --- | --- | --- | --- | --- |
| XLSX de tiempos Zendesk | 250 000 · 12,9 MB | 0,9 s | 131,9 s | 319,1 s | 236–303 MB | 30–531 MB |
| Repetición del mismo XLSX | 250 000 | 0,8 s | 120,3 s | 31,2 s | 235–275 MB | 205–549 MB |
| CSV original de Wrike | 1 000 000 · 77,4 MB | 1,0 s | 429,7 s | 169,3 s | 248–322 MB | 206–545 MB |
| Repetición del CSV | 1 000 000 | 1,0 s | 419,5 s | 149,5 s | 251–316 MB | 207–549 MB |

- **Repeticiones sin duplicar**: 250 000 registros y los mismos minutos tras la repetición; Wrike 884 800 registros válidos (el resto son tareas sin imputación y filas conservadas aparte) y mismos minutos (179 172 000) tras repetir.
- **Formato incorrecto**: un texto con extensión `.xlsx` se rechaza y no deja lote activable. **Subida interrumpida** (pestaña cerrada con la recepción en curso, comprobada con el lote en `RECEIVING`): queda `REJECTED` («Subida incompleta…»), 0 trabajos encolados y ningún original completo huérfano.
- **Exportación** de `horas` (2022–2026, servicio TOTAL): **1 134 800 hechos** en dos partes (1 000 000 + 134 800), generadas en 33,1 s; RSS del trabajador ≤ 370 MB, de la web ≤ 275 MB.
- **Descarga por el navegador** de la primera parte: **131 751 064 B**, SHA-256 y filas (1 000 000) idénticos al manifiesto del trabajo, sin identidades `(fuente, id_entrada)` repetidas; 3,5 s; RSS web 257–300 MB durante todo el intervalo; **consulta ligera en paralelo** (`/api/salud`, 12 muestras) p50 46 ms, p95 157 ms.
- **Cancelación** de una descarga: el export sigue LISTO con sus archivos, descriptores abiertos 0 → 0, y se puede volver a servir. **Lectura lenta** (lector que consume ≈1 MB/s durante 30 s, 30,8 MB de 125,6): RSS web 301–309 MB (sin crecimiento) y descriptor cerrado al abortar. **Archivo menor** (17,2 MB, 128 160 filas): crecimiento de RSS comparable: no proporcional al tamaño.
- Nota: la parte grande pesa ≈ 132 MB (los ≈ 230 MB de 09 correspondían a otro conjunto); lo relevante, ≥ 1 000 000 de hechos, sí se cumple. La lectura lenta usa un cliente Node con la cookie del navegador para controlar el ritmo; la descarga completa y la cancelación se hicieron con el navegador.

## Puente de conciliación (nivel 4)

`REC-N4-01…06` en la misma lectura `REPEATABLE READ`; con los datos conocidos cuadran (180 min = 180 min, 3 h, 100 usuarios, 1 N3, 1 PAP), por servicio (SOPORTE, ADMIN_DELEGADA), por ámbito (Grupo, Cliente, entidad seleccionada) y con CUM; un periodo que no es de las pantallas da `NO_DISPONIBLE` con la explicación. Pruebas en `tests/csapp10-puente.test.ts`.

## Advertencia de `pg`

Atribución hecha por el agente de rendimiento ([detalle](csapp-10-evolucion.md#advertencia-de-pg-calling-clientquery-when-the-client-is-already-executing-a-query)): no procede de código de Calidad; en `pg 8.23.1` se dispara con tres consultas simultáneas en un cliente y el origen reproducido es el intérprete de Prisma 7.10.1 con tres relaciones hermanas en una transacción interactiva. **No se corrigió ni se actualizó nada** (stack fijado); la dependencia mantiene el límite exacto. Se eliminó la concurrencia innecesaria de `loadGroupMeta`.

## Defectos hallados y corregidos durante el cierre

1. **`.gitignore` ignoraba `*.csv` y con ello los cuatro endpoints `src/app/api/analitica/*.csv/route.ts`**: un clon limpio habría dado 404 en todos los «Descargar CSV». Se versionaron y se excluyeron del patrón.
2. `/api/salud` quedaba tras la redirección a `/login` del proxy de sesión: se excluyó (solo devuelve el estado global).
3. `ops iniciar` no terminaba al negarse a arrancar (quedaba colgado); corregido.
4. La salud lanzaba una excepción con migraciones pendientes (tablas de operación inexistentes); ahora informa del esquema.
5. `isOperational` trataba como «no operativo» un entorno con `CSAPP_ENABLE_SYNTHETIC_PROFILES`, lo que lo habría dejado pasar sin comprobar; ahora es un error de arranque.

## No ejecutado / límites

- **Windows/PowerShell** (todo el recorrido, `INS-01`), **lector de pantalla**, proxy de producción, PostgreSQL remoto o gestionado, `kill -9` real a mitad de una copia y disco lleno real (simulados), otras versiones de `pg_dump`: **no ejecutados**.
- Revisión de presentación a 1 440 y 390 px, teclado y estados anunciados: comprobaciones **automáticas** en Chromium (sin desbordamiento horizontal, regiones desplazables enfocables, `role=status`, texto además de color); no equivalen a una revisión con lector de pantalla.
- Pulse y los otros benchmarks no se midieron con el árbol nuevo (solo cartera, ficha, backlog, diagnóstico, detalle y CSV de Calidad, dentro de ±14 %).
- Sin aceptación de Dennis ni despliegue; ECO 08, ZDT 11–13, ZTM 06–08, lista PAP, estados de bugs y «Diferencia» siguen pendientes; nada se activó.

## Reproducción

```text
npm ci && npm run build:todo
npm test ; npm run e2e ; npm run e2e:grandes ; npm run test:largo
npm run ensayo:instalacion
ENSAYO_ANTERIOR=<checkout compilado de 09> npm run ensayo:actualizacion
npm run ensayo:restauracion -- --salida resultado.json
```

Requieren `TEST_DATABASE_URL` a una base `cs_app…_test`, usuario con `CREATEDB`, herramientas PostgreSQL 16 y Chromium.

## Tests largos (`npm run test:largo`)

7 archivos, **12 pruebas correctas** (1 577 s), con el trabajador real, SIGKILL y 300 000 filas sin reducir (igual que en 09). La advertencia de `pg` aparece como en 09 (ver arriba).
