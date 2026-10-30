# Finanzas y motor económico (CSAPP-05): decisiones técnicas

Propietario de: el esquema físico incremental de las finanzas, su relación con `TimeActivity`, el cálculo consistente, los bloqueos, los conjuntos vigentes y las versiones. **No duplica reglas**: los contratos funcionales siguen en [Facturación](../importaciones/facturacion.md) (FAC 01-14), el [catálogo de fórmulas](../calculos/catalogo.md) (CAL 17-30), [Comparativa](../producto/comparativa.md), [Análisis Cliente](../producto/analisis-cliente.md) y [Administración](../producto/administracion.md); el motor de cargas, en [motor de cargas](motor-cargas-contrato.md). Resultados: [validación](../validacion/csapp-05.md). Prompt: [CSAPP-05-v1](../../prompts/CSAPP-05-v1.md).

## 1. Base y continuidad

Parte de `main` `24d365813ab2ba2703fa911f4e0dacd31fb781fb` (merge de la PR 5 de CSAPP-04, cuya cabeza `4d8653401830bcc939d73c2798e0667832ee72ba` está incluida). Eso confirma integración en Git, **no aceptación manual de Dennis ni pruebas en Windows**. La rama de la entrega es `claude/new-session-omvsmd` (designada por la sesión; el prompt proponía `feature/CSAPP-05-finanzas-motor-economico`): su punta anterior era la cabeza de la PR 5 (ya incluida en `main`), por lo que se avanzó con un push normal (fast-forward) tras crear el trabajo sobre `main`, sin force-push ni historia reescrita. Un push inicial a `feature/CSAPP-05-finanzas-motor-economico` se hizo por error y esa rama remota queda sin uso. Migración incremental `20261031090000_finanzas_motor_economico`: no edita las cuatro anteriores, no hace reset y no toca maestros, usuarios ni lo cargado.

## 2. Esquema físico

| Objeto | Función |
| --- | --- |
| `FinanceScope (year, category)` | **Puntero** al lote vigente de cada año y categoría y su `version`. Activar o revertir cambia el puntero y suma una versión. Es la clave de sustitución y la base de la revisión obsoleta. |
| `FinanceBatch (batchId)` | Cabecera financiera del lote: año, categoría, origen (`UPLOAD`/`HISTORICAL`), extracción declarada, controles (pie, totales, hoja), Total declarado, **tolerancia capturada al preparar**, revisión del impacto (versión y lote vigente vistos), huella de maestros BC y versión de derivación. |
| `FinanceRow` | Una línea económica única por huella. `income` es el valor usado (`NUMERIC(38,20)`); `incomeOriginal` conserva el vacío fuente; `incomeDerivedZero` marca el cero por decisión; `difference` va aparte; `groupId`/`resolution`/`resolutionDetail` son la atribución derivada (se recalcula sin tocar el dinero). |
| `FinanceDecision (batchId, kind, key)` | Decisiones del Administrador por lote: `EMPTY_AS_ZERO`, `YEAR_ASSIGNMENT`, `ACCEPT_UNASSIGNED`, `ACCEPT_COLLISION`, `ACK_UNVERIFIED_FOOTER`, `ACK_NO_TOTAL`, `ACK_RETROCESO`, con autor, motivo y fecha. |
| `EconomicSettingsRevision` | Revisiones **inmutables** de objetivo €/jornada, jornada y tolerancia, con autor y fecha. La migración inserta la revisión 1 (550 €, 8 h, 0,01 €); `ensureInitialSettings` la repone si una base de pruebas se vació. |
| `ServiceAssignment` | Asignación mínima de servicio (`SOPORTE`/`ADMIN_DELEGADA`/`OTROS`) por valor exacto de Entorno y Tipología o por proyecto de Wrike, con vigencia `[desde, hasta)` y exclusión de solapamientos en base de datos (`ServiceAssignment_no_overlap`). |
| `ExternalIdentity` (CHECK ampliado) | `ExternalIdentity_system_kind_target` admite Wrike/PAP con tipos de proyecto directamente a **Grupo Cliente**. La exclusión `ExternalIdentity_no_overlap` (sistema+tipo+valor, sea cual sea el destino) ya existía y protege las concurrencias. |
| Vista `TimeActivity` ampliada | Añade al final `teamId`, `levelId`, `roleId`, `implementationId`, `projectName`, `isInternal`, `ticketEntorno`, `ticketAdminDelegada`, `scopeConflict`. Las columnas anteriores no cambian. |

Importes: `NUMERIC(38,20)` en PostgreSQL y `Dec` (BigInt con escala fija 20, `src/domain/finance.ts`) en TypeScript. Nunca `Number` para sumar, normalizar ni calcular ratios; los importes viajan como texto decimal. Si el origen trae más de 20 decimales se redondea a esa escala y el texto original queda en la fila de staging. Restricciones: categoría, año 2000-2100, `income IS NOT NULL` en filas activas, cero derivado solo con vacío original, valores de configuración válidos.

## 3. Tres perfiles sobre un núcleo común

`src/server/finance/profile.ts` genera los perfiles `facturacion-soporte`, `facturacion-admin-delegada` y `facturacion-otros` con una fábrica (`REPLACE_SCOPE`, `selectsSheet`, `entityConflictPolicy: "conflict_all"`, `blocksConfirmOnErrors`). La categoría es fija del perfil (no se lee del navegador); el **año** y la declaración de conjunto completo se validan en servidor (`metadataSchema`, años 2000 a año actual + 1: sin la limitación de edición de usuarios al año actual). `scopeKey = año`, de modo que la clave de sustitución es perfil + año.

Contrato ampliado del motor (acotado, con regresión de los seis perfiles anteriores y del sintético): `ParsedRow.control` (fila de control: Total, pie; excluida sin aviso), `ImportProfile.confirmGate` (motivos que impiden confirmar, en servidor y ficha), `ImportProfile.checkActivation` (dentro de la transacción de activación, con el ámbito bloqueado: devuelve un motivo y el lote **vuelve a «listo»** sin aplicar nada) y metadato `checkbox`. El lector XLSX marca `f` en las celdas con fórmula y conserva una fórmula sin valor almacenado (no se evalúa ni se trata como cero).

Fila fuente: `typed = {key, vta, dif}` (clave normalizada e importes canónicos; la huella **no** depende de mayúsculas ni de la representación `1E3`/`1000`); `derived = {kind, grupo, vtaOriginal, difOriginal}` no entra en la huella. Clases de fila: `ECON`, `TEXT` (sin importes), `TOTAL`, `FOOTER_MARK`, `EMPTY`; `postPrepare` reclasifica por **posición**: todo lo posterior a «Filtros aplicados» es pie; una fila económica o de texto posterior al Total sin pie es `LINEA_TRAS_TOTAL` (error). Un nombre de cliente que empieza por «Total» no es una fila Total (solo `total`, `totales`, `total general`, `gran total`, `suma total`).

## 4. Revisión, bloqueos y conjuntos vigentes

`src/server/finance/review.ts` calcula, por SQL de conjuntos sobre el staging, controles, conciliación, resolución BC, colisiones, impacto frente al conjunto vigente y la lista de **bloqueos** (`ERRORS`, `EMPTY_SET`, `FOOTER_MISMATCH`, `YEAR_MISMATCH`, `FOOTER_UNVERIFIED`, `TOTALS_INCOMPATIBLE`, `NO_TOTAL`, `RECONCILIATION`, `EMPTY_INCOME`, `AMBIGUOUS`, `COLLISION`, `UNASSIGNED`, `RETROCESO`, `REVIEW`). Los mismos bloqueos se aplican al confirmar (`confirmUpload`), en la ficha y en el trabajador (`checkActivation`): no dependen de botones.

**Sustitución atómica.** `activate` escribe todas las `FinanceRow` del lote, el estado del lote, las procedencias, la auditoría y mueve el puntero de `FinanceScope` en la **misma transacción** del motor (`runActivate`, bajo el bloqueo asesor `perfil|año` y `SELECT … FOR UPDATE` del puntero). Un fallo o una muerte del proceso antes del commit deja exactamente el conjunto anterior. El conjunto anterior **permanece íntegro** (sus filas no se borran): por eso revertir solo mueve el puntero.

**Revisión obsoleta.** El Administrador pulsa «Revisar el impacto»: se guarda el lote vigente y la **versión del puntero** vistos (`reviewedScopeVersion`). Confirmar exige que coincida; la activación lo vuelve a comprobar con el ámbito bloqueado. Si otra carga (o una reversión) cambió el puntero, el lote vuelve a «listo» con el motivo y no se activa: serializar no basta para autorizar a pisar una base distinta de la revisada. Cualquier decisión nueva o retirada también invalida la revisión.

**Tolerancia.** Se captura al preparar. Si cambia antes de activar, se recalcula la conciliación con la nueva y solo si el resultado de la validación cambia se devuelve el lote a «listo» para revisar de nuevo. No forma parte de la huella de reglas.

**Recuperación.** `revert` (solo el vigente; el motor impide revertir un supersedido) devuelve el puntero al predecesor completo, o a ausencia de fuente si era el primero; nunca escribe un conjunto vacío «confirmado». `REDERIVE` (Reprocesar un completado) solo recalcula `groupId`/`resolution` con los maestros actuales y la huella `derivedStamp`; no cambia dinero, año, filtros ni extracción, no reactiva un lote y en un supersedido no toca el conjunto activo.

## 5. Resolución BC anual

`src/server/finance/resolve.ts`: equivalencias activas BC/`GROUP_KEY` con `searchValue` igual a la clave normalizada y vigencia que **intersecta el año**. Un único grupo → `RESOLVED` (se guardan los intervalos y los límites del año); grupos distintos → `AMBIGUOUS` (bloquea) salvo asignación anual explícita entre los candidatos (`DECISION`); ninguno → `UNRESOLVED`. No hay similitud ni creación de grupos. Una empresa nueva a mitad de año no se pierde. Sin asignar: sigue en el conjunto activo y en su conciliación; la cobertura es **parcial** y un grupo ausente no prueba cero.

## 6. Equivalencias Wrike/PAP a Grupo y retirada del atajo BC

`SYSTEM_RULES` y el CHECK de base permiten Wrike/PAP con `PROJECT_ID`/`PROJECT_NAME` hacia Grupo Cliente (validador `identitySchema`, formulario existente, auditoría, versión, vigencias y exclusión de solapamientos en base de datos). Zendesk `ORG_ID` sigue siendo de Cliente; los tipos de organización no admiten grupo. Los resolutores (`wrikeDerivationSql`, `papScopeSql`) usan la equivalencia a la **fecha del trabajo (Wrike)** y a la **fecha de producción (PAP)**; si el ticket identifica un Cliente del mismo grupo completa el desglose y si contradice el proyecto se conserva el conflicto. El fallback BC/`GROUP_KEY` ya **no atribuye**: `bcFallbackImpact` cuenta los tiempos Wrike y PAP cuya atribución dependía de él (se conservan como evidencia, se marca el recálculo pendiente en la referencia del motor y no se publican como validados); la acción es crear la equivalencia explícita y reprocesar. En la base de pruebas sintética no había registros dependientes (impacto 0); no se repara ningún dato de Dennis sin revisión.

## 7. Servicio económico de las horas

Sobre `TimeActivity` (una actividad es `(source, entryId)`, contada una vez). Servicio = evidencias que no se contradicen: (1) administración delegada identificada del ticket (`adminDelegada = true`); (2) `ServiceAssignment` `ENTORNO` por valor exacto (sin distinguir mayúsculas ni espacios repetidos) a la fecha del trabajo; (3) `WRIKE_PROJECT` para tiempos Wrike, con o sin ticket. Sin evidencia → `SIN_CLASIFICAR`; evidencias distintas → `CONFLICTO`. `adminDelegada = false` no prueba Soporte. Plan, equipo y causa no deciden el servicio; «otro soporte» de Pulse Rent no es OTROS financiero. Las horas sin servicio, sin elegibilidad o sin ámbito se conservan en desgloses separados y **no** se reparten.

## 8. Cálculo consistente

`runEconomics` abre **una** transacción `REPEATABLE READ`: una instantánea de ingresos, tiempos, usuarios, atribuciones y configuración. Un cambio concurrente no mezcla el ingreso de un lote con su predecesor ni publica derivados obsoletos como actuales. Devuelve la **referencia reproducible**: configuración usada (revisión), lotes y versiones de cada `(año, categoría)`, cobertura, versión máxima de derivación de tiempos, método, versión del motor y estado de recálculo pendiente (maestros BC distintos de los de la derivación; atribuciones por el atajo BC retirado). No hay cierres certificados todavía: hay reproducibilidad y límites explícitos.

Sin N+1: ámbito (una consulta), financiero (dos), horas (**una pasada** por `TimeActivity` con un `JOIN` de periodos —los cinco periodos y los meses de la serie—), usuarios (una por tipo de ámbito), metadatos (una). El número de sentencias no depende de grupos ni meses (`finanzas-volumen.test.ts` lo cuenta).

## 9. Histórico anterior a 2025

`importHistoricFinance` y `scripts/importar-historico-financiero.ts`: simulación por defecto, `--aplicar` explícito, rechazo de 2025 en adelante, ámbitos ya activos omitidos, idempotente y con procedencia (lote `COMPLETED`, origen `HISTORICAL`). La categoría se toma de columnas explícitas (`Admin Delegada` marcada → ADMIN_DELEGADA; `Soporte` con valor → SOPORTE); ambas o ninguna no se importan. No crea OTROS, Diferencia ni usuarios ni toca alojamiento/plan. No se ejecuta en migración, arranque ni instalación. **Precarga no realizada: falta fuente** (sin libro privado en el entorno).

## 10. Reglas propuestas, pendientes o heredadas (estado explícito)

Continuar con CSAPP-05 **no acepta** automáticamente las propuestas de CSAPP-04 ni las interpretaciones ZDT 11–13 y ZTM 06–08.

| Regla | Comportamiento | Prueba | Estado |
| --- | --- | --- | --- |
| ZDT 11–13, ZTM 06–08 | Ver [CSAPP-04 §2](wrike-pap-bugs-csapp04.md#2-revisión-acotada-de-las-interpretaciones-zdt-11-13-y-ztm-06-08) | `zendesk-*.test.ts`, `csapp04-*.test.ts` | Propuestas implementadas, **pendientes de Dennis** |
| Corrección sin ID | Conservada sin cambios | `csapp04-wrike.test.ts` | Implementada, pendiente de validar |
| Lista estable de origen PAP | Metadato obligatorio (no se sustituye por el nombre del archivo) | `csapp04-pap-bugs.test.ts` | Implementada, **pendiente de validación de Dennis** |
| Estados de bugs, lista de palabras de tickets, `CSAPP_DEVOPS_PRODUCTS` | Sin tocar | `csapp04-*.test.ts` | Propuestas implementadas |
| Equivalencia Wrike/PAP → Grupo | Sustituye al atajo BC | `csapp05-equivalencias.test.ts` | Implementada (CSAPP-05) |
| Tolerancia de conciliación 0,01 € | Revisión 1 de la configuración | `csapp05-admin.test.ts` | **Técnica/propuesta** (CAL 08) |
| Vacío de Vta Potencial como cero | Solo por decisión específica del lote con Total conciliado | `finanzas-importacion.test.ts` | FAC 07 **propuesto**; no es regla global |
| Convención de signo de «Diferencia» | Se guarda y muestra aparte; no se calcula Budget absoluto | `finanzas-importacion.test.ts` | Pendiente |
| Silver On Demand (ECO 08) | Ingresos guardados; sin rentabilidad mensual recurrente; análisis anual permitido | `economia-motor.test.ts` | Propuesto |
| Categoría del histórico por columnas | Interpretación de `DATA FACTURACIÓN` | `csapp05-admin.test.ts` | **Pendiente de validar con el libro real** |
| Cobertura de un conjunto histórico | `NO_CONFIRMADA`: la ausencia de un grupo no acredita cero | `csapp05-admin.test.ts` | Decisión técnica de CSAPP-05 |
