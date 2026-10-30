# Validación de CSAPP-05: facturación anual y motor económico

Registro de lo **ejecutado de verdad** en Linux. No hay pruebas en Windows/PowerShell, **no hay aceptación manual de Dennis** y **no se ha cargado ningún archivo real ni ningún dato operativo**: todo se probó con XLSX y datos sintéticos generados por `tests/generators/finance.ts`, `tests/economia-helpers.ts` y SQL de siembra, solo en bases aisladas `_test`. No se afirma ninguna aceptación ni porcentaje de acierto. Decisiones técnicas: [finanzas y motor económico](../arquitectura/finanzas-motor-csapp05.md); prompt: [CSAPP-05-v1](../../prompts/CSAPP-05-v1.md).

## Entorno

Linux 6.18 (4 CPU, 16 GB), Node 22.22.0, npm 10.9.4, PostgreSQL 16.15 local (base `cs_app_test`, aislada: nombre acabado en `_test`, distinta de `cs_app`), Chromium de Playwright 1.63. Dependencias sin actualizar. Rama `claude/new-session-omvsmd` sobre `main` `24d365813ab2ba2703fa911f4e0dacd31fb781fb` (merge de la PR 5 de CSAPP-04; cabeza `4d86534…` incluida). Migración nueva: `20261031090000_finanzas_motor_economico`.

## Comandos y resultados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Sin errores (una advertencia anterior de CSAPP-03 en `scripts/e2e/casos/09-zendesk.ts`) |
| `npm run e2e:build` | Build de Next y del trabajador correctos |
| Migración | `prisma migrate deploy` desde cero en cada ejecución de pruebas; `tests/migracion-csapp05.test.ts`: **sobre una base con las cuatro migraciones anteriores y datos sintéticos** (grupo, equivalencia BC, tiempos Zendesk y Wrike) conserva todo, amplía la vista y las equivalencias, siembra la revisión 1 y es repetible; y sobre una base limpia aplica las cinco |
| `npm test` | **23 archivos, 338 pruebas correctas** con PostgreSQL real (326 s). Nuevas de CSAPP-05: 26 de importación financiera, 17 del motor, 8 de equivalencias a grupo, 11 de configuración/servicio/histórico/seguridad y 2 de migración (64); más ajustes en `cargas.test.ts` (lista de perfiles: nueve operativos), `migracion.test.ts` y `migracion-csapp03.test.ts` (cinco migraciones) y en el helper de equivalencias de CSAPP-04 (grupo directo en lugar de clave BC) |
| `tests/finanzas-trabajador.test.ts` (trabajador real compilado) | **2 pruebas correctas** (9 s): fallo inyectado en mitad de la sustitución y SIGKILL con la transacción de activación abierta |
| `tests/finanzas-volumen.test.ts` | **2 pruebas correctas** (circuito de 60 000 grupos y motor con 250 000 tiempos; ver medidas) |
| `tests/csapp04-volumen.test.ts` (regresión de Wrike/PAP/bugs, cuyos resolutores cambiaron) | Correcta; medidas de tiempos similares a las de CSAPP-04 |
| `npm run e2e` (build final) | **193 comprobaciones correctas, 0 fallos** en Chromium sobre `next start` y el trabajador compilado: 31 nuevas de CSAPP-05 (caso `11-finanzas`) y el resto de CSAPP-01 a 04 (con tres comprobaciones actualizadas porque ya no quedan fuentes pendientes) |

### Regresiones de rendimiento del motor compartido

- `tests/cargas-trabajador.test.ts` (CSAPP-02, trabajador real): con `CSAPP_TEST_RESTART_ROWS=100000` **pasa (3/3)**. Con el valor por defecto (300 000 filas) la preparación no llega a «listo» en los 120 s que fija la prueba **en este entorno, y falla igual con el código de `main` sin ningún cambio de CSAPP-05** (comprobado con un `git worktree` de `origin/main`): es un límite temporal de la máquina, no una regresión. Un fallo de esa prueba deja un trabajador huérfano que interfiere con las siguientes ejecuciones; hubo que terminar el proceso a mano.
- `tests/zendesk-volumen.test.ts`: ver «Medidas» (se repitió porque el lector XLSX y la vista `TimeActivity` son comunes).
- No se repitió `cargas-volumen` (1 000 000 filas CSV de CSAPP-02): el único cambio común en la preparación es una condición por fila.

## Casos del prompt (§12) y su prueba

| Caso | Evidencia automática (Linux, PostgreSQL real) |
| --- | --- |
| Tres perfiles | `finanzas-importacion.test.ts` («tres perfiles, año y filtros»): XLSX de cada categoría con pie/Total y año seleccionado en servidor; categoría equivocada y año explícito incompatible rechazados; pie ausente/no verificable exige declaración; orden libre de columnas, espacios, columna extra con aviso, cabeceras ausentes/duplicadas y hojas múltiples |
| Precisión | `finanzas-importacion.test.ts` («importes»): decimales largos, científicos, negativos, cero y residuo `0.30000000000000004`; suma exacta sin `Number` y sin redondeo por fila; `domain` `Dec` |
| Vacíos y controles | vacío conserva null sin decisión; decisión específica (motivo, actor, cero derivado, Diferencia no usada); Total no se importa; fórmula sin valor y texto inválido son error; subtotal, línea posterior al Total, totales incompatibles; discrepancia superior a la tolerancia bloquea |
| Duplicados | idénticos una vez (misma clave normalizada); clave contradictoria bloquea; repetición completa conserva el conjunto |
| Sustitución | admin 2026 de 100 a 120 deja 120 (nunca 220); fila ausente retirada; soporte/otros y otros años intactos; preparar y revisar no cambian hechos activos |
| Atribución | identidad nueva a mitad de año, sin asignar (aceptación y cobertura parcial), cambio de destino dentro del año (asignación anual explícita y auditada, equivalencias sin alterar), colisión, reproceso recupera el grupo sin cambiar dinero |
| Vigencia revisada | dos lotes preparados sobre A: al activar B, C vuelve a «listo» y exige actualizar el impacto; una reversión también invalida la revisión |
| Atomicidad | `finanzas-trabajador.test.ts` con el trabajador compilado: fallo inyectado (trigger en `_test`) y SIGKILL con la transacción abierta; conjunto anterior íntegro y, al reiniciar, sustitución una sola vez |
| Recuperación | cadena A→B→C, reversión del vigente, restauraciones sucesivas hasta ausencia de fuente; supersedido no reversible; REDERIVE de un supersedido no toca el conjunto activo |
| Equivalencias | `csapp05-equivalencias.test.ts`: «Proyecto A» → «Grupo B», solo grupo, vigencias por fecha del trabajo y de producción, conflicto de ticket, rechazo de solapamientos concurrentes y de combinaciones prohibidas (también CHECK en base) |
| Fuente histórica PMO | `economia-motor.test.ts`: 2 h Zendesk PMO 2024 + 3 h Zendesk PMO 2025 excluidas + 4 h Wrike PMO 2025 elegibles + no PMO sigue Zendesk (la política vive en la derivación de CSAPP-04; aquí se comprueba que el motor la consume) |
| Servicio | `economia-motor.test.ts`: admin confirmado, soporte/otros asignados, desconocido, conflicto, `adminDelegada=false` sin prueba, proyecto Wrike sin ticket, asignación vencida; ratio parcial por horas sin clasificar |
| Prorrateo | 12000 con corte 15/30 → 500; 15/31 → 1000×15/31; febrero (28 y 29), mes completo, cruce de año |
| Periodos | enero → diciembre anterior; CUM ≠ año anterior completo ≠ CUM comparable; 29/02/2024 → 28/02/2023; exclusión de horas posteriores al corte |
| Ratio ponderado | 1000/10 y 1000/30 → 400; 1000/0 + 1000/10 → 1600 con el primero no calculable; independiente de la paginación; cartera cero no divide |
| Cero y falta de dato | sin fuente ≠ ausente en conjunto completo (cero confirmado) ≠ conjunto parcial ≠ histórico no confirmado; horas cero; usuarios sin informar (con ratio económico) |
| Usuarios | 65→68, 665 usuarios mes y stock 68; fracción de mes; hueco = exposición incompleta; cero confirmado no divide; implantaciones no suman al grupo |
| Ámbito | grupo con dos clientes y tiempo solo de grupo contado una vez; Cliente con «ingreso agrupado en Grupo Cliente»; filtro parcial sin falsa rentabilidad |
| Configuración | `csapp05-admin.test.ts`: revisión 1 inicial; nuevo objetivo cambia el resultado conservando la revisión previa; edición concurrente rechazada; valores inválidos; auditoría; tolerancia capturada |
| Histórico | `csapp05-admin.test.ts`: solo <2025, simulación por defecto, idempotencia, ámbito existente protegido, sin OTROS/usuarios ficticios |
| Seguridad | `csapp05-admin.test.ts`: sin sesión/Consulta no mutan cargas, decisiones, revisión, reversión, equivalencias, parámetros ni asignaciones; estado idéntico antes/después |

En el navegador (`11-finanzas`, 31 comprobaciones) se prueban la carga financiera completa por la interfaz, la vista previa del reemplazo con su impacto, las decisiones relevantes (importes sin asignar, vacío de Vta Potencial con y sin motivo), la repetición (15.000 €, no 30.000), la sustitución con retirada (12.600 €), la reversión del vigente y la no reversión de un sustituido, la comprobación económica (12.000 anuales con corte 15/30 → 500,00 €; mes completo 1.000,00 €), la configuración con edición obsoleta y revisión anterior identificada, las asignaciones de servicio con rechazo de solapamientos y los permisos de Consulta con una petición forjada.

## Medidas (Linux, este entorno; sintéticas, un solo intento)

Se anotan tamaño, máquina y comando; **no se promete ningún tiempo objetivo**. Comando: `CSAPP_COUNT_QUERIES=1 CSAPP_TEST_MEASURES_FILE=<archivo> npx vitest run tests/finanzas-volumen.test.ts` (4 CPU, 16 GB, PostgreSQL local).

**Circuito financiero** (XLSX de 60 000 grupos, 1,0 MB; la mitad de los grupos de origen está en el maestro y la otra mitad se acepta como sin asignar; trabajador real; dos cargas seguidas, la segunda sustituye a la primera):

| Fase | Primera carga | Sustitución |
| --- | --- | --- |
| Recepción | 0,08 s | 0,03 s |
| Preparación (lectura, validación, staging, controles) | 28,9 s (≈2 080 filas/s) | 29,3 s |
| Decisión «sin asignar» (análisis completo) | 5,5 s | 6,5 s |
| Revisión del impacto | 5,3 s | 6,5 s |
| Activación atómica (60 000 líneas + puntero) | 20,3 s | 20,7 s |

Pico de memoria del trabajador: **867 MB** (VmHWM). Tras la sustitución quedan activas exactamente 60 000 líneas (no 120 000). Límite conocido: el análisis de revisión carga en memoria del servidor las líneas resueltas del lote (no llegan al navegador); para tamaños muy superiores a las decenas de miles de grupos convendría resolver los agregados solo por SQL.

**Motor económico** (1 500 grupos, 250 000 tiempos: 150 000 Zendesk y 100 000 Wrike repartidos en 22 meses, tickets de 5 Entornos y Tipologías con servicios asignados y sin asignar, 17 % de Wrike sin grupo, elegibilidad pendiente/excluida, tres categorías financieras en dos años, usuarios de dos años; siembra de 8,2 s):

| Consulta | Tiempo | Sentencias SQL | ΔRSS del proceso |
| --- | --- | --- | --- |
| Cartera de Soporte, todos los grupos, CUM + periodos + serie (página de 50) | 6,8 s | 17 | 97 MB |
| Cartera Total (tres categorías), mes completo | 7,2 s | 17 | 99 MB |
| Cartera con filtro de proyecto | 2,1 s | 17 | 59 MB |
| Un grupo con serie mensual | 0,25 s | 17 | 0 MB |
| Detalle paginado de ingresos | 0,006 s | 3 | 0 MB |
| Detalle paginado de horas (CUM, 25 filas) | 0,105 s | 3 | 0 MB |

El número de sentencias es **constante (17)** con independencia del número de grupos y de meses (sin N+1); las horas se leen en una sola pasada por `TimeActivity` con un `JOIN` de periodos; la prueba comprueba además que la suma de horas del periodo no supera la de la tabla (sin multiplicación por joins) y que la cartera usa el conjunto completo aunque se devuelva una página.

## Discrepancias y decisiones de implementación

- **Usuarios en el motor.** El prompt pide reutilizar `usersAtCutoff` y `userMonthsExposure`. Ambas consultan por ámbito (una lectura por grupo y mes en una cartera), por lo que el motor **reimplementa su semántica por conjuntos** (una consulta por tipo de ámbito y años): stock al corte = valor del mes del corte, exposición = Σ valor × días incluidos / días reales con decimales exactos y huecos que dejan la exposición incompleta. Los servicios de CSAPP-02 no se modifican y siguen siendo la referencia de la semántica; su prueba (665 usuarios mes, stock 68) se repite en el motor.
- **Lectura consistente.** El mecanismo es una única transacción `REPEATABLE READ` (`runEconomics`). No hay una prueba con escrituras concurrentes durante una ejecución: lo comprobado es que devuelve la referencia de lotes y versiones, no que se haya forzado una carrera.
- **Tolerancia.** Se captura en `FinanceBatch` al preparar y no forma parte de la huella de reglas; un cambio posterior solo devuelve el lote a «listo» si cambia el resultado de la conciliación.
- **Etiquetas del histórico.** La categoría de `DATA FACTURACIÓN` se infiere de las columnas «Admin Delegada»/«Soporte» (sin cobertura de Total, por lo que su cobertura es «no confirmada»): interpretación a validar con el libro real.
- **Rama.** La sesión designaba `claude/new-session-omvsmd`; el prompt proponía `feature/CSAPP-05-finanzas-motor-economico`. Se usó la designada con un push normal (fast-forward sobre la cabeza de la PR 5, ya fusionada), sin force. Un push inicial a la rama sugerida se hizo por error y quedó sin uso.

## Límites y pendientes

- **No probado:** Windows/PowerShell; aceptación manual de Dennis; archivos reales de 2025 y 2026 (los realiza Dennis); el libro histórico real (`DATA FACTURACIÓN`); despliegue; subida de archivos grandes por el navegador; un recorrido visual (diseño) más allá de las comprobaciones de texto y comportamiento.
- **Precarga no realizada: falta fuente.** No hay libro privado en el entorno; el adaptador histórico está probado con datos sintéticos y los maestros siguen vacíos.
- **Reglas pendientes o propuestas** (sin aceptar): ZDT 11–13, ZTM 06–08, lista estable de origen PAP, estados de bugs, palabras de tickets, `CSAPP_DEVOPS_PRODUCTS`, tolerancia de 0,01 €, vacío de Vta Potencial como cero (solo por decisión de lote), signo de Diferencia, Silver On Demand (ECO 08), categoría del histórico. Ver [la tabla](../arquitectura/finanzas-motor-csapp05.md#10-reglas-propuestas-pendientes-o-heredadas-estado-explícito).
- **Sin dashboards, Pulse Rent ni semáforos de Calidad** (CSAPP-06 a 08). La comprobación de Administración es una herramienta de validación, no el diseño final.
