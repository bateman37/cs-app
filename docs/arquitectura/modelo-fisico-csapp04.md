# Modelo físico de CSAPP-04

Migración `20261030120000_wrike_pap_bugs` (incremental sobre CSAPP-03). Decisiones de comportamiento: [Wrike, PAP y bugs](wrike-pap-bugs-csapp04.md).

| Cambio | Contenido |
| --- | --- |
| `UploadStagedRow.derived` (jsonb) | Datos derivados del propio texto fuente (candidatos de ticket, causas, referencias, enlaces). **No entra en la huella** ni usa maestros |
| `ZdTimeDecision.targetRevision` | Revisión del registro objetivo que el Administrador vio; índice único parcial `(batchId, targetEntryId)` para correcciones |
| `WrikeTimeEntry` | Imputación Wrike (originFingerprint único; `hours`, `minutes = hours × 60` con restricción; `explicitState/explicitTicket/nameCandidates`; columnas `drv*` derivadas) |
| `WrikeTimeCorrection`, `WrikeTimeDecision` | Mismo modelo que Zendesk, con revisión del objetivo y un objetivo por fila del lote |
| `PapItem` (`listKey` + `papId`), `PapRevision`, `PapObservation`, `PapCause`, `PapReference` | Entidad, contenido (29 campos en `data`), presencia por lote, pertenencias a causas y referencias (tickets, bug, CAL, texto) |
| `WorkItem` (`product` + `scopeKey` + `workItemId`), `WorkItemRevision`, `WorkItemObservation` | Work Items VFS/VSW separados, revisiones con hora local sin zona, fotografías |
| `WorkItemLink`, `WorkItemLinkEvidence` | Par Work Item–ticket único; decisión manual (`manualState`, versión) independiente de la evidencia por lote y fuente; `drv*` resolución |
| Vista `TimeActivity` | Unión de `ZdTimeEntry` y `WrikeTimeEntry` con `source`, `minutes`, `eligibility`, `isEligible` |

`ZdTimePreview` y `ZdPreviewStamp` se reutilizan para Wrike (son genéricas por lote). No se modifican datos existentes: `ZdTimeDecision.targetRevision` es nula en las decisiones anteriores y estas siguen valiendo.
