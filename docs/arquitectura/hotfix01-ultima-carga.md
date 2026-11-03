# HOTFIX-01: última carga, instantáneas de tiempos y PAP único

Decisiones técnicas de [CSAPP-HOTFIX-01-v2](../../prompts/CSAPP-HOTFIX-01-v2.md) (§3–§5). Las reglas funcionales viven en [proceso común](../importaciones/proceso-comun.md) (IMP 08–IMP 12), [PAP](../importaciones/pap.md) (PAP 01 y PAP 06), [tiempos Zendesk](../importaciones/zendesk-tiempo.md) y [Wrike](../importaciones/wrike.md). Migración: `20261106090000_hotfix01_ultima_carga` (incremental; no edita las anteriores).

## Secuencia de recepción

`UploadBatch.receptionSeq` (BIGINT, secuencia PostgreSQL `UploadBatch_receptionSeq_seq`) la asigna `receiveUpload` en la misma transacción que deja el lote en cola, cuando el archivo está completo. Los lotes anteriores reciben número por `createdAt, id` y `legacyBase = true`. Es la única señal de «lo último»: ni posición de filas, ni reloj del navegador, ni fecha de extracción.

| Entidad | Dónde manda la secuencia |
| --- | --- |
| Ticket Zendesk | `recomputeCurrent` en `zendesk/tickets.ts`: la observación vigente es la del lote de mayor secuencia |
| PAP | `recomputeCurrent` en `pap/profile.ts` (mismo criterio) |
| Work Item | `recomputeCurrent` en `bugs/profile.ts` (mismo criterio) |
| Finanzas (año+categoría) | `runActivate`: si el lote activo del ámbito tiene mayor secuencia que el que se activa, este se cancela con motivo y no lo sustituye |
| Tiempos | vistas de actividad activa (abajo) |

Las fechas del dato (observación, extracción declarada, Changed Date) se siguen guardando y no se reescriben; solo dejan de decidir cuál es el estado actual. El reproceso (`REDERIVE`) no cambia secuencias ni observaciones.

## Instantánea activa de tiempos

Una entrada de tiempo (`ZdTimeEntry`, `WrikeTimeEntry`) se materializa una vez por huella de origen y pertenece a cada lote que la aportó mediante `UploadRecordSource`. La actividad **activa** de una fuente es:

- si existe un lote COMPLETADO de esa fuente con `legacyBase = false`: las entradas aportadas por el de mayor secuencia;
- si no existe: toda la base heredada (comportamiento anterior).

Vistas: `ActiveTimeBatch(profileId, batchId)`, `ActiveZdTimeEntry`, `ActiveWrikeTimeEntry`; `TimeActivity` (con las mismas columnas) lee solo estas vistas, por lo que Comparativa, ficha, Pulse, Calidad, conciliación, detalles y exportaciones no pueden contar instantáneas sustituidas. Revertir el lote activo deja activo el siguiente de mayor secuencia o la base heredada; revertir uno antiguo no cambia lo activo (las entradas que solo él aportó se retiran con la regla de huérfanas ya existente). Zendesk y Wrike tienen conjuntos independientes. Ya no se marcan filas `PENDING_DECISION` automáticamente; las decisiones explícitas heredadas siguen funcionando.

Limitaciones conocidas: filas idénticas dentro de un mismo export cuentan una vez (regla de duplicados exactos); la sustitución es completa, de modo que un archivo parcial (un solo mes) oculta lo demás: la ficha muestra el impacto antes de confirmar y se revierte con «Revertir».

## PAP con identidad única

El namespace técnico es `pap` (`PAP_NAMESPACE`). La migración consolida los `PapItem` con el mismo `papId`: el canónico es el de la observación vigente de mayor secuencia; se reasignan revisiones y observaciones, se fusionan revisiones con la misma huella, se renumera `revisionNo` y se recalcula el puntero vigente; `UploadBatch.scopeKey` y `UploadRecordSource.dedupeKey` pasan a `pap`. La lista original permanece en `UploadBatch.metadata`. Límite: `changedFields` de una revisión conserva la comparación contra su predecesora original.

`PAP_RULES = pap-v2`. La migración reclasifica las causas ya cargadas de «Petición cliente» (`CLIENT_REQUEST`) y deriva el estado correctivo (`NON_CORRECTIVE` si solo hay causas conocidas no correctivas).

## Formularios y estado de controles

El formulario envía solo archivo (+ año en finanzas). `metadataSchema` de cada perfil ya no exige lista, vista, ámbito ni conjunto completo; `hoja` queda opcional y, ante varias hojas compatibles, el lote se rechaza con el motivo concreto. El año financiero es un entero de cuatro dígitos (1900–9999, `FINANCE_YEAR_MIN/MAX`). `Vista amplia` se guarda como `metadata.vista = AMPLIA` (contrato de la fuente). Estilos: `.btn[disabled]` usa `not-allowed`; `aria-busy` solo con operación enviada; `StatusPoller` cancela temporizador y petición al desmontar y se detiene sin trabajo activo.
