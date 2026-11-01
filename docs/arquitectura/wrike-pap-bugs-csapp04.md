# Wrike, PAP y bugs VFS/VSW (CSAPP-04): decisiones técnicas

Propietario de: la ampliación de correcciones sin ID, la política histórica compartida por Zendesk y Wrike, el contrato exacto de identidad PAP y de referencias, y el alcance de las fotografías de bugs. Los contratos funcionales siguen en [Wrike](../importaciones/wrike.md), [PAP](../importaciones/pap.md) y [bugs de producto](../importaciones/bugs-producto.md); el motor, en [motor de cargas](motor-cargas-contrato.md); el modelo físico, en [modelo físico CSAPP-04](modelo-fisico-csapp04.md).

## 1. Base y continuidad

Se parte del `main` 3c08fc0c647088d2b226d1385b95e1daa8142843 (merge de la PR 4 de CSAPP-03, que ya incluía 171d63ea3960d53ebdb6226a7b82e12598bef720). La rama de la sesión (`claude/new-session-omvsmd`) solo contenía historia ya fusionada y se reinició desde ese commit con `git checkout -B` (sin force-push ni rebase de historia publicada). No se tocan PR anteriores. Migración incremental `20261030120000_wrike_pap_bugs`: sin reinicio ni limpieza.

## 2. Revisión acotada de las interpretaciones ZDT 11–13 y ZTM 06–08

Continuar con CSAPP-04 **no acepta** ninguna de estas interpretaciones: siguen siendo propuestas implementadas y pendientes de que Dennis las valide. La tabla contrasta cada una con el encargo original, el comportamiento actual y su prueba.

| Id | Encargo original | Comportamiento | Prueba | Cambio en CSAPP-04 |
| --- | --- | --- | --- | --- |
| ZDT 11 | Una revisión no es una observación; un export anterior no pisa el contenido reciente; sin sobrescritura silenciosa | Revisión = contenido distinto; observación por lote y fecha (extracción declarada o recepción); vigente = observación más reciente, empate por recepción del lote y orden, nunca por posición. El empate técnico se informa y **no acredita el instante real de la transición de estado** | `zendesk-tickets.test.ts`; el mismo patrón se replica en PAP y Work Items (`csapp04-pap-bugs.test.ts`: export anterior no pisa, REDERIVE conserva fechas, revertir no restaura por encima de una posterior) | Reutilizado en PAP y bugs con la misma incertidumbre visible (misma fecha → «orden incierto») |
| ZDT 12 | Errores contradictorios sin elegir por posición | Mismo ticket con contenido contradictorio en un archivo: todas las filas son error y el lote no se confirma | `zendesk-tickets.test.ts` | Mismo criterio `conflict_all` en PAP (mismo ID) y bugs (mismo Work Item) |
| ZDT 13 | Vínculos y clasificaciones dependientes de maestros se calculan con maestros actuales | Cliente, interno, Grupo, alojamiento e «Incidente Vincle» se derivan al consultar con la **fecha de creación del ticket** | `zendesk-tickets.test.ts` | **No se reutiliza ciegamente** para horas: la causa de las horas Wrike se clasifica con el alojamiento vigente a la **fecha del trabajo** (`CLOUD` actual no corrige retroactivamente `OP`) |
| ZTM 06 | Una partición contable única y conciliable; los indicadores no suman | Un motivo principal por fila; la suma reconcilia filas y minutos | `zendesk-tiempos.test.ts` | Wrike tiene su propia partición conciliable (`WRIKE_BUCKETS`) |
| ZTM 07 | Una posible corrección es mismo `id` y contexto con contenido distinto; decisión explícita; nunca por parecido ni sin `id`; sin bandeja masiva | Candidato automático por `id`+ticket+persona+día; el aviso se conserva, **sin imponer unicidad global a ese `id`** | `zendesk-tiempos.test.ts` | **Ampliada** (ver §3): ya hay selección explícita de un registro activo sin ID externo; sigue sin haber candidatos automáticos masivos para las filas sin `id` |
| ZTM 08 | Relaciones tardías y reproceso sin releer ni cambiar fechas | `REDERIVE` sobre el lote completado; automático al activar o revertir tickets | `zendesk-tiempos.test.ts` | Extendido a Wrike (ticket confirmado, cliente, causa) y a vínculos Work Item–ticket, bajo el mismo bloqueo |

## 3. Ampliación de las correcciones sin ID

Carencia comprobada en CSAPP-03: `corrections.ts` solo decidía una fila ya candidata y exigía `sourceId == typed.id`; sin id no había candidato ni corrección manual, y Wrike carece de ID de imputación. Ahora, **dentro de un lote listo para revisar** y solo con el Administrador:

- Cualquier fila válida y única (disposición `NEW`, `PENDING_DECISION` o `CORRECTION`) puede declararse «corrige ESTE registro activo de la misma fuente» (`decideTimeCorrection`). Los filtros (ticket, persona, días, texto) **localizan**, no deciden; no hay candidatos masivos ni parecidos.
- La ficha muestra la fila y el registro lado a lado, los campos que difieren y los minutos antes/después; hay que marcar la confirmación de **esa** sustitución.
- El servidor valida: fuente (el objetivo debe existir en la tabla de registros de la fuente del lote; uno de otra fuente no existe para ella), lote (`FOR UPDATE`, estado `READY`, versión esperada), fila (válida, única, materializable), objetivo activo y **revisión del registro vista** (`ZdTimeDecision.targetRevision`/`WrikeTimeDecision.targetRevision`), y que un registro solo sea objetivo de una fila del lote (índice único parcial).
- La activación **sustituye** el contenido (no suma duración antigua más nueva), guarda el anterior en `*TimeCorrection`, aplica el cambio de ticket/persona/día si lo hay y recalcula lo derivado. Una decisión **obsoleta** (el objetivo cambió o desapareció tras decidir) deja la fila `PENDING_DECISION`: ni corrige a ciegas ni se crea un registro nuevo.
- Revertir restituye el contenido anterior respetando correcciones posteriores vigentes y lotes compartidos (`revertTimeBatch`).
- Auditoría: antes/después, minutos y revisión del objetivo en cada decisión (`TimeDecision`).
- El aviso por coincidencia `id`+contexto de CSAPP-03 sigue igual y no impone unicidad global a ese `id`. `ZdTimeEntry.sourceId` conserva su significado (ID externo del log); el origen WRIKE/ZENDESK se distingue en la vista común, no en ese campo.

Código: `src/server/time-correction.ts` (común), `src/server/zendesk/corrections.ts` (decisión, objetivos, comparación).

## 4. Representación común y política histórica

La vista SQL `"TimeActivity"` une `ZdTimeEntry` y `WrikeTimeEntry` con `source` inequívoco, `minutes` decimales, `eligibility` e `isEligible`, sin fusionar tablas. Política única, por fecha del trabajo y pertenencia PMO histórica de la persona:

| Situación | Zendesk | Wrike |
| --- | --- | --- |
| Antes de 01/01/2025 | `ELIGIBLE` según su contrato | `BEFORE_CUTOFF`: se conserva, no sustituye el histórico |
| Desde 01/01/2025, PMO | `EXCLUDED_PMO` (conservado) | `ELIGIBLE` |
| Desde 01/01/2025, no PMO | `ELIGIBLE` | `NOT_PMO` (fuera del tiempo PMO elegible) |
| PMO desconocido | `PENDING_ELIGIBILITY` | `PENDING_ELIGIBILITY` (también sin persona resuelta) |

No hay deduplicación entre sistemas por ticket/persona/día: la selección de fuente evita el doble conteo. Rol ANA/DEV se desglosa por vigencia cuando existe; un rol desconocido no elimina horas con PMO y ámbito conocidos. La heurística del libro (DEV = incidente Vincle; causa «customización» sin ticket) **no** se reproduce: sin ticket confirmado la causa es «no clasificada».

## 5. Wrike

- Cabeceras por contenido y orden libre (seis). CSV real (BOM, comas, comillas y saltos conservados); el parseo de horas es propio del perfil: entero, o decimal con **una** coma o punto; `1.500`/`1,500`, mezclas (`1.234,5`) y negativos se rechazan; `0,5 h = 30 min` (×60 exacto, sin división).
- Ticket explícito: se normalizan los puntos de millares solo ahí y con gramática válida (`216.527 → 216527`); cero o vacío = sin ticket; notación inválida = aviso, se conserva y **no** se sustituye por un número del nombre. Prioridad: explícito > único candidato del nombre (URL de hosts Zendesk configurados con `CSAPP_ZENDESK_HOSTS`, prefijo `ticket/tkt/zendesk/zd` o `#ID` no precedido de bug/pbi/work item…, o ID inicial delimitado de 5–9 cifras que no sea fecha ni versión) > nada. Varios candidatos: ninguno (ni el primero ni el mayor). Un explícito o candidato que aún no existe se conserva como **referencia pendiente**; se confirma al cargar el ticket.
- Una fila sin usuario, sin fecha y con cero horas es tarea sin imputación (`EXCLUDED`, bruto conservado). Horas positivas sin fecha: error obligatorio.
- Ámbito: la equivalencia de Proyecto Wrike apunta a Cliente o implantación; **desde CSAPP-05** un proyecto que solo identifica un **Grupo Cliente** se declara con una equivalencia Wrike de proyecto **directamente a Grupo** (ver [finanzas y motor económico §6](finanzas-motor-csapp05.md#6-equivalencias-wrikepap-a-grupo-y-retirada-del-atajo-bc)); el atajo por clave BC de CSAPP-04 (propuesta) **fue sustituido y ya no atribuye**. Con ticket confirmado de un Cliente del mismo grupo se completa el desglose; si ticket y proyecto señalan clientes/grupos incompatibles, las horas se conservan con `SCOPE_CONFLICT`. Los tickets internos (VINCLE BUGS…) no completan ni contradicen el ámbito.
- Partición: `BEFORE_CUTOFF`, `NOT_PMO`, `PENDING_ELIGIBILITY`, `SCOPE_CONFLICT`, `NO_SCOPE`, `GROUP_ONLY`, `CLIENT` (más duplicadas y pendientes de decisión). Indicadores no aditivos: ticket (explícito/inferido/pendiente/ambiguo/inválido/contradicción), persona, rol, proyecto, causa no clasificada.

## 6. PAP: contrato exacto

- **Identidad**: `^(?:ID\s+)?([0-9]+)\s*:` sobre `Title` recortado, sin distinguir mayúsculas; el ID se normaliza sin ceros a la izquierda. Clave = **lista de origen** (metadato obligatorio `lista`, validado y normalizado a minúsculas; no se inventa por archivo, año, proyecto o posición) + ID. Sin identidad reconocida: error claro (nunca un hash del título ni el primer número). El mismo ID con contenido distinto en un archivo: conflicto sin elegir.
- **Revisión** (mismo ID, contenido distinto): `PapRevision` con `changedFields`; **observación** por lote y fecha; la ausencia en otra descarga no borra; un export declarado anterior no pisa.
- **Causas** (`;#`): tokens originales y normalizados, ordenados (el orden no duplica); familia por palabra clave (cualquier `Correctivo …`, también uno nuevo, es correctivo); correctivo si cualquiera lo es; sin causa o etiqueta desconocida = «sin clasificar» (no «no correctivo» confirmado); origen del correctivo conservado (estándar, personalización, configuración/datos, procesos, infraestructura, **origen cliente**). Totales por PAP distinto; las pertenencias no son aditivas.
- **Fechas**: el periodo es `Fecha puesta en producción`; sin ella se muestra «sin fecha de producción»; `Fecha de Solicitud` vacía es válida; una fecha ilegible se conserva como texto. `Duración` es texto y nunca se suma a horas.
- **Referencias**: `Tickets asociados` y `Ticket PAP Asociado` con roles distintos; formatos admitidos: URL Zendesk de los hosts configurados, `#ID`, ID de 3–12 cifras, `ticket ID`, con separadores `;#`, `;`, `,`, `|` y salto de línea (varios números solo separados por espacios valen si todos son IDs puros); pares deduplicados; el resto se conserva como texto no interpretable con su motivo. `CAL's asociados` se conserva sin tratarse como tickets. `Nº de BUG`: referencia con producto explícito (`VFS 123`, `VSW-123` o URL de un proyecto DevOps configurado en `CSAPP_DEVOPS_PRODUCTS`) se resuelve al llegar su Work Item; un número suelto queda con «producto sin determinar» aunque solo una fuente esté cargada.
- **Ámbito**: equivalencia PAP de Proyecto (Cliente, implantación o, desde CSAPP-05, directamente Grupo; la clave BC ya no atribuye), a la fecha de producción (sin fecha, solo equivalencias sin vigencia acotada). Un grupo solo no se reparte. Las contradicciones con los tickets citados se muestran y no sobrescriben el contexto.

## 7. Bugs VFS y VSW

- Perfiles independientes (`bugs-vfs`, `bugs-vsw`); todas las cabeceras comprobadas son obligatorias, por contenido; el producto nunca se deduce (un CSV del otro producto se rechaza explicándolo). Identidad: producto + ámbito DevOps (metadato `ambito`, por defecto «principal») + Work Item ID.
- Fechas `d/M/yyyy HH:mm:ss` se conservan como **hora local sin zona** (`createdLocal`, `changedLocal`); no se fabrica un UTC. `Changed Date` es modificación, no cierre.
- Solo `Work Item Type = Bug_` participa en defectos. Estados: catálogo de etapas (New, Selected, In Progress, Blocked, PR = desarrollo terminado pendiente de crear la pull request, Done (Ready for Release) = pendiente de entrega); cualquier otro (incluido «Done») queda «fuera del catálogo: requiere revisión»; los terminales son solo los configurados en `CSAPP_BUG_TERMINAL_STATES` (por defecto ninguno). El `State` es independiente del `status` de Zendesk.
- **Fotografías**: el metadato `vista` (abiertos, intervalo, amplia, otra) más la extracción, el intervalo y la cobertura declarados describen el alcance. La presencia es una observación por lote; la ausencia en otra vista no cierra ni borra: se rotulan «no observados en esta vista» con su última observación y no cuentan como abiertos actuales confirmados. No se reconstruyen estados anteriores al primer dato.
- **Vínculos**: `Zendesk Ticket ID` y URLs de tickets reconocidas en `Clients` (hosts configurados); pares Work Item–ticket únicos con **evidencia** por lote y fuente; `href=#` y menciones no son tickets; no se renderiza HTML. Un ticket interno es el central y no identifica a los clientes afectados; el tipo real del ticket (incident/problem) se conserva. La **revisión manual** (confirmar/rechazar, con versión y auditoría) es independiente de la evidencia: otro CSV no la borra. Reported by y nombres libres son contexto.
- Dato preparado para el sexto indicador: pares Work Item–ticket resueltos por tipo (`WorkItemLink.drvTicketType`) con `isBug`; no se implementa su semáforo ni se suman bugs, problemas e incidentes.

## 8. Recálculo y concurrencia

Todas las escrituras de derivados (tickets, tiempos Zendesk, Wrike, PAP, vínculos) toman primero el bloqueo de ámbito del motor y después el único bloqueo de derivación (`csapp-zd-derive`), siempre en ese orden, dentro de la transacción de activación/reversión/recálculo: no hay recálculos recursivos (la llegada de tickets recalcula Wrike y vínculos una vez) ni orden de bloqueos invertido. Todo recálculo es idempotente: solo escribe lo que cambia, versiona (`drvVersion`) y no toca fechas originales ni observaciones. Las fichas leen instantáneas indexadas (`ZdTimePreview`, `ZdPreviewStamp`, columnas `drv*`) y avisan si los maestros cambiaron después.
