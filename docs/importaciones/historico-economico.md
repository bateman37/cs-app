# Histórico económico y usuarios (CSAPP-HOTFIX-01 §6–§7)

Contrato dueño de la entrada **«Histórico económico y usuarios»** de Administración › Cargas. Sustituye a la vía asistida anterior a 2025 (`importHistoricFinance` y su script, retirados): aquella rechazaba 2025 en adelante, trataba `Soporte` no vacío como Soporte aunque dijera «Admin Delegada» y se ejecutaba por línea de comandos. Las reglas financieras generales (decimales exactos, sustitución por año+categoría, resolución BC) siguen en [facturación](facturacion.md) y en el [motor financiero](../arquitectura/finanzas-motor-csapp05.md); las de usuarios, en [la matriz de usuarios](../arquitectura/usuarios-matriz-csapp02.md).

Estado: implementado y probado con PostgreSQL real, con datos sintéticos y con un ensayo del libro real en una base aislada (ver §9). **No se ha cargado ninguna base de Dennis.** Pendiente de aceptación.

## 1. Qué se sube y qué sale

Solo el archivo `DATA FACTURACIÓN.xlsx` (una hoja `DATA FACTURACIÓN`, A1:I165, SHA-256 `d79f05cd…6628`; no hay año, categoría ni casilla que indicar). Es el segundo paso de la puesta en marcha, tras los maestros. Antes de confirmar la ficha muestra un **resumen automático por año y categoría** con su impacto; **«Confirmar y activar»** aplica **todos** los conjuntos del libro o ninguno.

| Columna | Lectura |
| --- | --- |
| A | Grupo cliente / denominación BC |
| B | **Facturación anual**: importe de origen, decimal exacto (nunca `Number`; se conserva el texto original) |
| C | Año (cabecera «Año » con espacio final admitida) |
| D | Plan histórico (`Gold`, `Platinum`, `Silver`…) o el literal `Admin Delegada` |
| E | Facturación mes: **referencia**, no se suma al anual |
| F | Indicador Admin Delegada 0/1 |
| G | Servidor (búsqueda externa con valor almacenado) |
| H | Usuarios (informados en 2025) |
| I | Vacía: no es un campo |

Nunca se ejecutan fórmulas ni enlaces externos: se usa el valor almacenado; una fórmula sin valor es un error, no un cero.

## 2. Reglas de lectura (`src/domain/finance-history.ts`)

- **Categoría.** `D = «Admin Delegada»` o `F = 1` coherentes → `ADMIN_DELEGADA` (no es ambiguo: las 11 filas administrativas reales se admiten). `D` con una etiqueta de plan y `F = 0` → `SOPORTE`. Contradicciones (D administrativa con F=0; F=1 con un plan en D) o ni D ni F → **error** en esa fila; no se inventa categoría.
- **Subtipo.** La etiqueta histórica de D se conserva tal cual; «Silver» no se convierte en Silver On Demand ni Recurrente actuales: el subtipo queda «no informado». No se escribe ningún `ServiceTerm` (plan, alojamiento, complejidad).
- **Año.** Cuatro dígitos (rango técnico de finanzas). Se admiten 2025 y anteriores (y cualquier año válido): el límite `<2025` desaparece.
- **B** debe ser un importe legible; vacío es error (no se importa como cero). **E**: se clasifica frente a B (`B/12`, excepción `B/6`, otra) y solo se muestra. La excepción **E164 = B164/6** se conserva y se señala («referencia con B/6 en lugar de B/12»); no se deduce un mes de arranque ni se multiplica E por 12 para el anual. El ingreso se imputa por el método anual/12 documentado; la diferencia de referencia es visible.
- **G**: un error de búsqueda (`#N/A`, filas 28 y 100 del libro real) se conserva como alojamiento **no informado**; la fila y su ingreso no se descartan y no se sigue el enlace. El valor cacheado de una búsqueda actual no demuestra vigencia histórica.
- **H**: entero ≥ 0 (decimales, negativos o texto → error). Una fórmula aritmética con resultado almacenado (H160) se lee como valor y se señala. Un valor en un año distinto de 2025 se avisa y no se usa.
- Filas idénticas dentro del libro cuentan una vez; el mismo Grupo+año+categoría con contenido distinto bloquea todas sus filas (`CONFLICTO_EN_ARCHIVO`).
- **No** se exige pie «Filtros aplicados» ni Total de control de Power BI: no hay certificación externa. La conciliación es interna: Σ de B y número de filas de cada año+categoría del libro frente a lo aplicado.

## 3. Arquitectura (decisión y razones)

Se **reutiliza el motor financiero** (`FinanceBatch`, `FinanceRow`, `FinanceScope`, `REPLACE_SCOPE` por año+categoría) en lugar de duplicarlo:

1. Un **lote «libro»** (perfil `historico-economico`, `src/server/finance/historic.ts`) conserva el XLSX original y su SHA-256, valida por el motor común y es la **unidad de confirmación**. Política `REPLACE_SCOPE` con ámbito único `historico`: un libro posterior sustituye al anterior como registro.
2. Al activar, en **una sola transacción** (fencing, advisory locks por ámbito en orden determinista, mismos candados que una carga financiera normal), se crean **lotes hijos `COMPLETED` por año+categoría** (origen `HISTORICAL`) con sus `FinanceRow` y el puntero de `FinanceScope` actualizado atómicamente. Un fallo en cualquier ámbito deshace todo: no hay éxito global parcial.
3. **Referencia al original sin rutas ficticias.** Cada hijo lleva el `checksum` del libro y `metadata.loteOrigenId`; su `storageId` es un identificador real del almacén (enlace duro o copia del mismo archivo), de modo que copia de seguridad, restauración y comprobación de SHA-256 funcionan sin excepciones.
4. **Idempotente.** Cada conjunto lleva una huella de contenido (`contentHash`); si el vigente tiene la misma, el ámbito queda «sin cambios» y no se crea otro lote ni se suma nada. Repetir el libro no cambia ingresos.
5. **Sustitución explícita.** Si el año+categoría ya tiene conjunto (p. ej. 2025 cargado antes por el perfil normal) el resumen lo marca «Sustituye el conjunto vigente», con filas, total y diferencia. El resumen se calcula al preparar y se guarda una huella de los punteros (`__hist.stamp`): si otra carga cambia esos ámbitos antes de confirmar, la confirmación y la activación se rechazan hasta pulsar «Reprocesar» y ver el impacto actualizado.
6. **Ausentes intactos.** Solo se tocan los ocho (o los presentes) ámbitos del libro; OTROS, 2026 y cualquier otro conjunto no cambian. No se inventa OTROS ni Diferencia.
7. **Reversión** del libro: restaura el conjunto predecesor de cada año+categoría que ese libro escribió, también en una sola transacción; si alguno ya fue sustituido por una carga posterior no se revierte nada (se pide revertir primero la posterior). Un hijo no se revierte aislado. La reversión no borra Grupos de procedencia histórica ni matrices de usuarios (datos de maestros que pueden tener ajustes manuales).
8. Solo Administrador sube, confirma y revierte; se revalida en servidor y en el trabajador. Auditoría de cada conjunto (antes/después) y del libro.

Cobertura económica: los conjuntos históricos mantienen el estado «cobertura no confirmada»; la ausencia de un Grupo no acredita ingreso cero (comportamiento ya vigente del motor para `HISTORICAL`).

## 4. Grupos ausentes del maestro

Los Grupos económicos sin equivalencia BC `GROUP_KEY` (dos en el libro real) se crean como **Grupo Cliente de procedencia histórica**: `ClientGroup` + equivalencia BC + `HistoricGroupOrigin` (lote de origen y nota). **No** se crean Clientes Zendesk, IDs, implantaciones ni usuarios inventados y no se declara estado comercial actual por su ausencia en CLIENTES. Si ya existe un Grupo con ese nombre sin equivalencia BC, la confirmación se bloquea con un aviso (no se duplica). Equivalencias existentes pero fuera de vigencia, o ambiguas, no crean nada: el ingreso se conserva sin atribuir y el resumen lo cuenta.

## 5. Usuarios de 2025 (columna H)

H contiene 43 valores para 39 Grupos: un Grupo puede figurar en Soporte y en Administración delegada. **No se suman filas financieras.** Por Grupo:

- Una sola cifra (o la misma en ambas categorías) → base resuelta.
- Cifras distintas → **discrepancia**: se conservan ambos valores con su celda (`H124/H165`, `H132/H161`, `H143/H162`, `H152/H163` en el libro real; `HistoricUserBase`), el denominador queda **sin informar (nunca cero)** y se resuelve por **elección explícita** en la ficha de usuarios del Grupo (`resolveUsersBase`, solo Administrador, con motivo y auditoría). Nunca máximo, suma ni última fila.
- Con base resuelta se inicializa la **matriz del Grupo** (solo del Grupo; no Clientes, implantaciones ni Personal), rellenando únicamente meses sin informar:
  - 2025: los doce meses con el mismo número (`INITIAL`; condición inicial, no doce personas distintas);
  - 2026: desde esa base (`COPIED`, «Copia de 2025-MM»), editable mes a mes;
  - 2022–2024: `ESTIMATED` con procedencia **«Estimado a partir de 2025»**, solo en los años en que el Grupo tiene ingresos en el libro; si no hay base o hay conflicto, `null`.
- **Recarga**: nunca pisa un mes ya informado ni revierte un ajuste manual (ni una cifra distinta del libro cambia lo ya informado). La matriz y la ficha de usuarios muestran el tipo («Estimado a partir de 2025») y la procedencia de cada mes; el motor económico (motivo de la tarifa por usuario, también en su CSV) y el de calidad (nota de la explicación) avisan cuando el denominador es estimado y no lo presentan como medición histórica. No existe un CSV de la matriz. La rentabilidad por jornada no usa este denominador.
- No se siembran años futuros ni al arrancar; la inicialización solo la ejecuta la carga confirmada o la resolución explícita, sin dejar marcas ni bypass abiertos.

## 6. Qué no hace

No ejecuta fórmulas ni enlaces; no crea OTROS, Diferencia, Clientes, IDs ni implantaciones; no convierte «Silver» en Silver On Demand/Recurrente; no suma E; no certifica con un total externo; no carga ninguna base real por sí solo.

## 7. Cambios de contrato que introduce

Sustituye FAC 14 («rechazo de 2025 en adelante», vía de línea de comandos) y «Dennis importará 2025 y 2026…» de FAC 08 respecto a 2025; USR 03 pasa de «solo el año natural en curso» y «2025 cerrado» a «año actual y anterior» (ver la matriz). Las pruebas que asumían el límite `<2025`, la categoría por `Soporte` no vacío, el 2025 fijo bloqueado o «solo año actual» se han reescrito (`tests/csapp05-admin.test.ts`, `tests/usuarios*.test.ts`) porque describían reglas sustituidas, no requisitos vigentes.

## 8. Pruebas

`tests/historico-economico.test.ts` (sintéticas, resultados esperados escritos a mano): clasificación D/F, B/E/G/H, ocho ámbitos con sus sumas exactas, idempotencia, sustitución explícita con 2025 ya cargado, ámbitos ausentes intactos, obsolescencia por cambio concurrente, atomicidad (fallo forzado en un ámbito → ninguno activo, sin Grupos ni usuarios), reversión, Grupos de procedencia histórica, usuarios (12 meses, 2026, estimados, discrepancia y su resolución, recarga sin pisar ajustes), ventana de edición 2026/2027/2028, mutaciones forjadas, migración de bloqueos, permisos. `tests/historico-ensayo-real.test.ts`: ensayo del libro real (se salta sin archivo).

## 9. Ensayo con el libro real (base aislada `cs_app_ensayo_historico_test`)

Ejecutado con el libro privado (no versionado): 164 filas en 8 ámbitos (2022: 35+1, 2023: 39+2, 2024: 40+4, 2025: 39+4; 11 administrativas), 0 errores, sumas de B por año+categoría iguales a las de una lectura independiente del XML, 46 Grupos (2 creados como procedencia histórica), excepción `E164` y errores `G28`/`G100` señalados, 43 valores de usuarios para 39 Grupos con 4 discrepancias, `H160` leído como valor almacenado; aplicación → 8 lotes hijos con el SHA-256 del original; repetición → 8 conjuntos «sin cambios» y sin ingresos duplicados; 35 matrices de Grupo inicializadas (12 meses iguales), 4 Grupos sin denominador hasta resolver. No es una carga de la base de Dennis.
