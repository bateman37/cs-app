# Calidad, Client Health y backlog observado (CSAPP-08): arquitectura

Decisiones técnicas y discrepancias de [CSAPP-08](../../prompts/CSAPP-08-v1.md). Los contratos de producto son [Calidad](../producto/calidad.md), [backlog y antigüedad](../producto/backlog-antiguedad.md) y [diagnóstico por origen](../producto/diagnostico-origen.md); las fórmulas, el [catálogo](../calculos/catalogo.md) (CAL 45–52). Aquí solo el esquema físico, la compatibilidad, los servicios comunes y las observaciones.

## Base de partida y PR apilada

`main` (`f71b5b7`) incluye CSAPP-05 pero no 06/07. La cabeza de la PR 7 (`e0f17e4`, rama `claude/new-session-omvsmd`) contiene 06 y 07 (la PR 8 de CSAPP-07 se fusionó **en la rama de la PR 7**, no en `main`). CSAPP-08 vive en `feature/CSAPP-08-calidad-client-health`, creada desde `e0f17e4`, y su PR se abre contra la rama de la PR 7 para mostrar solo los cambios de 08. Integración en Git no equivale a aceptación de Dennis.

## Esquema físico (migración `20261103090000_calidad_health_cobertura`)

Incremental: no modifica ni borra tablas anteriores ni la `ConfigRevision` de CSAPP-07.

| Tabla | Contenido y garantías |
| --- | --- |
| `HealthFeedback` | Una celda por ámbito (Grupo **o** Cliente), año y mes. CHECK de destino único (`num_nonnulls = 1`), mes 1–12, estados `POSITIVE/NEGATIVE/MIXED/NONE`; únicos `(groupId, year, month)` y `(clientId, year, month)`; `version` para `expectedVersion`; `feedbackOn` opcional (no es la fecha de guardado). `NONE` = celda limpiada (sin comentario ni fecha): equivale a «sin feedback», no a cero |
| `HealthFeedbackEvent` | Historial inmutable (disparador de solo añadir): versión, acción (`CREATE/UPDATE/CLEAR`), estado nuevo y anterior, autor, instante. La auditoría general añade el antes/después JSON |
| `QualityNote` | Nota sencilla de revisión de QA (ámbito, periodo, tema, evidencia en texto, autor). Solo se añade; no es un gestor de tareas |
| `UploadCoverageDeclaration` | Declaración **tipada y versionada** de cobertura de un lote: población (`ALL_CLIENTS/PARTIAL/UNKNOWN`), estados contenidos, alcance temporal, extracción revisada, motivo y autor. Solo se añade; la vigente es la de mayor versión. No cambia filas, extracción original ni observaciones |

Índices nuevos: `ZdTicketRevision(createdOn)` (flujo por creación) y `ZdTicketObservation(observedOn, batchId)` (selección de fotografía).

## Compatibilidad de la configuración (v1 → v2)

`ConfigRevision` sigue siendo inmutable. La carga de Calidad pasa a `quality-config-v2`:

- reglas **por ámbito** (`GRUPO` y `CLIENTE`) y **por unidad** (`MetricUnit`); una regla solo se aplica a una métrica de su misma unidad (si no, «regla no aplicable», nunca un cambio de escala oculto);
- backlog por tipo (incidentes y problemas) y ámbito, en **envejecidos por 100 usuarios (stock al corte)**;
- política de fotografía (`EXACT` por defecto o «última anterior dentro de X días» elegida expresamente) y catálogo de correspondencias de diagnóstico versionado.

Una revisión v1 se lee mediante `adaptQualityV1` **sin modificar su JSON ni recalibrarla**: la regla de cada indicador se conserva en su ámbito declarado y con su unidad, el otro ámbito queda sin configurar; la regla de backlog por usuario se convierte de forma **explícita** ×100 (límites absolutos; los percentiles no cambian) y se aplica a incidentes y problemas en su ámbito; una unidad v1 incompatible con la métrica queda visible y la regla no se aplica. Las notas del adaptador se muestran en Administración y en Calidad. Guardar o activar crea una **revisión nueva en v2** (las notas del adaptador no se persisten).

## Evaluador común

`src/domain/quality-config.ts` contiene el evaluador puro (`evaluateRule`, `evaluateEntity`, `effectiveWeights`, `evaluateGlobal`). Lo usan el simulador de Administración (escenarios manuales) y el motor del dashboard (`src/server/quality/engine.ts`), de modo que no hay dos reglas de color. Correcciones frente a CSAPP-07 (con contraejemplos en `tests/calidad-dominio.test.ts`):

| Punto observado | Corrección |
| --- | --- |
| `effectiveWeights` retiraba del denominador todo indicador no disponible | Solo la ausencia de Health redistribuye. Asignación, contribución disponible y cobertura son magnitudes separadas; un técnico ausente conserva su peso |
| Health con mapeo propuesto devolvía color | Color solo con `health.confirmed`; feedback sin mapeo activo = «sin calibrar» (conserva peso, bloquea el global) |
| `backlogStockRate` devolvía envejecidos/usuarios | Unidad y factor explícitos: 100 × envejecidos/usuarios al corte |
| `sourceCoverageSql` (EXISTS de filas fechadas) | Contrato de cobertura declarada (`quality-coverage.ts` + `UploadCoverageDeclaration`) |
| Un `scope` por indicador | Reglas por ámbito; ningún umbral de Grupo se aplica a un Cliente |
| `worstOfFlowAndBacklog=false` permitía un flujo «saludable» | Sin composición elegida no hay color del KPI; se muestran los componentes y una alerta roja conocida |

## Motor de Calidad

Una instantánea `REPEATABLE READ` lee, en una transacción, entidades, usuarios, hechos, Health, cobertura, fotografía y configuración; el evaluador es puro. Una consulta por familia de hechos (tickets creados, PAP, horas, stock), nunca una por entidad, KPI o mes. Las referencias por percentiles se calculan **para la métrica de Calidad**, ámbito y unidad correctos, sobre la membresía de la referencia de Pulse (solo criterios; los valores no se copian de columnas de Pulse), con ceros válidos y sin los no calculables. Los filtros de presentación, el color y la página no mueven la cohorte ni las tarjetas.

Fuentes por indicador (resumen; detalle en [Calidad](../producto/calidad.md)): horas por `TimeActivity` (elegibilidad PMO por fecha del trabajo) con perfiles de la revisión activa de Pulse; PAP únicos por lista+ID; tickets por **fecha de creación** (flujo, N3, sexto indicador `S ∪ B`); stock por **observaciones** de un lote (`ZdTicketObservation` → su revisión, no `currentRevisionId`).

## Fotografías y cobertura

Una fotografía compatible es un lote de tickets **completado y no revertido**, con **extracción conocida** (declarada al cargar o revisada por el Administrador), población «todos los clientes» y estados «todos» o «solo sin resolver». Para un corte R: la del propio día; nunca una posterior. Con la política exacta, una anterior solo se muestra aparte como «observado en D» (edad y usuarios de D); con la política elegida se usa como provisional. Sin fotografía el stock es no disponible y la serie histórica tiene hueco: no se rellena con el estado actual ni se interpola. La reversión de un lote retira sus observaciones y solo las revisiones que ningún otro lote sustenta (CSAPP-03).

La cobertura por fuente, periodo y tipo de dato la sustenta una declaración vigente: un cero de flujo exige cobertura declarada completa (tickets: «todos los estados»); sin declaración, el cero es «no sustentado» y un valor distinto de cero es una cota inferior (parcial). El contrato se comparte con Pulse y la ficha a través del mismo servicio (`loadDeclarations`/`coverageOf`); **Pulse Rent sí lo adopta** (verificado en CSAPP-09: `src/server/pulse/service.ts` llama a `loadDeclarations` y `coverageOf` para decidir si una fuente está completa; corrige esta frase, que decía lo contrario). Se mantiene la distinción entre **cero sustentado** (cobertura declarada completa), **parcial** (cota inferior) y **sin fuente/no sustentado** (sin valor ni semáforo saludable).

## Sello de datos y lectura coherente

`readDataStamp` añade observaciones de tickets, estado de lotes, Client Health y declaraciones de cobertura. **CSAPP-09** audita el sello como **detector de cambios** (no certificado ni archivo): añade las observaciones de Work Items (una observación nueva sin cambio de contenido cambia la frescura sin crear un bug nuevo), los punteros de observación vigente de tickets y Work Items, el estado derivado y la fecha de derivación de los vínculos y su evidencia (que un lote sustente o deje de sustentar un vínculo): seis omisiones demostradas por `tests/csapp09-sello.test.ts`, que falla con el sello anterior. El CSV de Client Health se lee en **una** instantánea con sello y fecha de lectura (antes paginaba con llamadas independientes y devolvía un sello vacío). Ver [validación de CSAPP-09](../validacion/csapp-09.md). Una observación nueva **sin cambio de contenido**, una reversión, un feedback editado o una configuración distinta invalidan el resultado anterior. El detalle y el CSV comparan el sello recibido y avisan de una lectura nueva (`x-lectura-nueva`); no simulan la instantánea antigua.

## Permisos

ADMIN y Consulta leen análisis, detalles y CSV; solo ADMIN edita Health, notas, cobertura y configuración y simula el borrador. Las acciones comprueban el rol vigente en la base (no el objeto de sesión). Configurar, simular o activar no modifica datos fuente; no se envían notificaciones.
