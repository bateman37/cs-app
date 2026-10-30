# Importadores Zendesk (CSAPP-03): decisiones técnicas

Implementa [ZDT](../importaciones/zendesk-tickets.md) y [ZTM](../importaciones/zendesk-tiempo.md) sobre el [motor común](motor-cargas-contrato.md) sin crear un segundo sistema de cargas. Estado: **implementado y probado en Linux** con PostgreSQL y trabajador reales ([validación](../validacion/csapp-03.md)); no probado en Windows; no aceptado por Dennis. Código: `src/server/zendesk/` (perfiles, derivación, resúmenes, correcciones) y `src/domain/zendesk.ts` (reglas puras).

## Perfiles

| Perfil | `id` | Versión | Formato | Hoja |
| --- | --- | --- | --- | --- |
| Tickets Zendesk | `zendesk-tickets` | 1 (esquema `v1-ocho-campos`) | XLSX | Una compatible; con varias, metadato `hoja` obligatorio |
| Tiempos Zendesk | `zendesk-tiempo` | 1 (esquema `v1-once-campos`) | XLSX | ídem |

Ámbito de deduplicación: **ninguno** (`scopeKey` nulo) y política `INCORPORATE`: ni el intervalo exportado, ni el año, ni la organización, ni la extracción crean otro espacio de deduplicación. El mismo registro en un export enero–junio y otro mayo–octubre se materializa una vez.

## Validación del libro

- **Cabeceras por contenido** (`mapHeaders`): Unicode NFC, espacios (incluido NBSP) colapsados, sin distinguir mayúsculas; **no se quitan acentos** (`fecha_creacion` no es `fecha_creación`). Orden libre. Faltantes y duplicadas/ambiguas se rechazan con su lista; las columnas adicionales se informan en el resumen del lote y no entran en la huella ni en fórmulas.
- **Hojas**: el motor inspecciona solo la primera fila de cada hoja visible (`headerOnly` del lector). Una hoja compatible se lee sola (otras, p. ej. «Resumen», se ignoran); varias compatibles rechazan el lote pidiendo la hoja; ninguna rechaza con el motivo de la primera incompatible. Nunca se elige una al azar.
- **IDs exactos** (`parseExactId`): texto o número de Excel sin pasar por flotantes. Una notación científica solo se acepta si el entero es exacto (≤15 cifras significativas); en otro caso, error. Una celda con formato de fecha no es un ID.
- **Fechas**: la fecha de Excel llega ya resuelta con el calendario 1900 o 1904 del libro (el lector). Texto: `AAAA-MM-DD` y `DD/MM/AAAA` (también `-` y `.`), **siempre día primero**; una zona horaria (`Z`, `+02:00`) se rechaza por ambigua para un día de negocio. Un número sin formato de fecha no se interpreta como fecha.
- **Decimales** (`parseDecimal`): exactos como texto canónico; sin comas (ambiguas con miles); negativos y vacíos son error, cero es válido.
- **Errores y bloqueo**: filas con ID principal, fecha o duración ilegibles son `ERROR` con fila, hoja y campo; no activan datos. Con errores pendientes el lote **no se confirma** (`blocksConfirmOnErrors`): se corrige el archivo, se sube de nuevo y se cancela el lote. Organización, persona o ticket sin equivalencia son avisos de atribución, nunca errores.

## Modelo de datos (migración `20261030080000_zendesk_tickets_y_tiempos`)

| Tabla | Papel |
| --- | --- |
| `ZdTicket` | Una entidad por `ticket_id` (texto exacto). Punteros de lectura `currentRevisionId` y `currentObservationId` mantenidos por el servicio (sin FK para evitar ciclos) |
| `ZdTicketRevision` | Una por **contenido funcional** distinto (clave `ticketId`+huella). Tags como conjunto ordenado, destinos por tag exacto, `adminDelegada`, clasificación conocida/no clasificada de `type` y `status`, `changedFields` y `previousRevisionId` |
| `ZdTicketObservation` | Un lote vio este ticket con esta revisión en una fecha (extracción declarada `DECLARED` o recepción `RECEIVED`). Única por `(lote, ticket)` |
| `ZdTimeEntry` | Registro de tiempo materializado: once campos tipados, `minutes` exacto y columnas derivadas `drv*` versionadas. Única por huella de origen |
| `ZdTimeCorrection` | Corrección explícita: contenido anterior (instantánea), minutos antes/después, lote y autor |
| `ZdTimeDecision` | Decisión del Administrador sobre una fila con posible corrección |

Restricciones (CHECK): ID numérico, duraciones no negativas, vocabulario de elegibilidad/motivo/decisión. Índices por ticket, fecha, persona, Cliente, motivo, `(sourceId, ticketId)`, procedencia y un parcial `(Cliente, fecha)` de los atribuibles. Las filas fuente originales, hoja y fila se conservan en `UploadStagedRow`; las procedencias en `UploadRecordSource`.

## Tickets: revisión, observación y vigencia

- Huella = JSON canónico de los ocho campos tipados con los **tags como conjunto**: reordenar o repetir un tag no crea revisión ni ticket. El bruto conserva la representación recibida.
- Dos filas del mismo `ticket_id` con contenido distinto **en el mismo archivo** son contradictorias: política de motor `conflict_all` marca **todas** como error `CONFLICTO_EN_ARCHIVO` y no se activa ninguna elección arbitraria.
- La activación inserta por SQL de conjuntos: tickets nuevos, revisiones nuevas (con diferencias contra la anterior) y **una observación por ticket y lote**, también cuando el contenido ya era conocido (la huella conocida no impide registrar presencia).
- **Vigencia**: la observación más reciente por `observedOn`; empate por recepción del lote y después por orden de activación; nunca por posición de fila. La previsualización cuenta las observaciones anteriores a la vigente (se conservan como histórico) y las de la misma fecha (orden incierto, criterio explícito).
- Sin extracción declarada: `observedKind = RECEIVED` y la ficha avisa de frescura desconocida; nunca se deduce de la creación, del nombre o de la fecha del archivo.
- La ausencia en otro export no elimina ni cierra. No existe `solved_at`.
- Reprocesar un lote conserva su observación (`observedOn` sale de la extracción declarada o de la recepción del lote, que no cambian).
- **Reversión**: retira las observaciones del lote y solo las revisiones que ningún otro lote sustenta; recalcula la vigencia con las observaciones restantes (no restaura una revisión antigua sobre otra posterior todavía observada) y borra el ticket que se queda sin sustento. Los tiempos no se borran: se recalcula su atribución.

## Vínculos y campos derivados de tickets

Se calculan al consultar (`ticketViewSql`), con los maestros actuales: organización → Cliente por `ExternalIdentity` ZENDESK/ORG_ID vigente a la **fecha de creación**; Cliente interno/externo del indicador del maestro; Grupo BC pendiente solo para externos; alojamiento (`ServiceTerm` HOSTING) del Cliente y, si no, del Grupo a la fecha de creación. Filtro **Incidente Vincle**: las cuatro causas exactas; `incidente_infraestructura` solo con CLOUD vigente a esa fecha (OP no cuenta; alojamiento desconocido = `PENDIENTE`). Se guardan en la revisión (no dependen de maestros): destinos por tag exacto y `adminDelegada` (cadena «delegada» sin distinguir mayúsculas en Entorno y Tipología; `null` si el campo falta).

## Tiempos

- **Duración**: `minutes = logged_hours × 60 + logged_minutes` en `numeric` exacto; las horas se obtienen al agregar (`sum(minutes)/60`). `hour` se conserva como hora del día (`HH:MM:SS`), nunca se suma. Sin redondeo por fila.
- **Identidad**: huella de los once campos fuente tipados. `id` es dato opcional, sin unicidad global.
- **Posible corrección** (ZTM 05): fila nueva con el **mismo `id` y el mismo contexto** (ticket, persona —`user_id`, o nombre si no hay ID— y día) que un registro activo, con contenido distinto. Se advierte; mientras no se decida, la fila queda en disposición `PENDING_DECISION`: conserva su bruto, **no añade horas y no cuenta como fuente aportada**, y el resto del lote se activa. Decisiones (en la ficha, solo con el lote `READY`, auditadas, con el lote bloqueado): *corrige el registro X* (revisión del registro interno; instantánea del contenido anterior; no suma antiguo más nuevo), *es otro trabajo* (se materializa) o *sin decidir*. Sin `id` no hay candidatos: nunca se corrige por parecido ni se genera una bandeja masiva.
- **Atribución** (`derivationSql`, una única definición usada por previsualización, activación y recálculo): ticket y organización desde la observación vigente; Cliente por equivalencia vigente a la fecha del trabajo; persona por `user_id` con alias vigente y, solo si falta, por alias de **nombre explícito** (nunca por parecido; un ID reconocido no se reasigna por el nombre: se marca `NAME_ID_CONFLICT`); nivel, equipo y PMO del maestro vigente a la fecha del trabajo.
- **Corte PMO**: antes del 01/01/2025 cualquier persona es elegible; desde esa fecha PMO se excluye (se conserva), no PMO es elegible y PMO desconocido queda **pendiente** (no se asume CS). El criterio es la fecha del trabajo y la pertenencia histórica, no la carga ni el nivel N3/N4. Reutilizable por el importador de Wrike en 04.
- **Partición contable** (un motivo principal por fila, en este orden): duplicada en el archivo, duplicada de lotes ya importados, pendiente de decisión, excluida por PMO, elegibilidad pendiente, sin ticket, ticket sin organización, organización sin Cliente, sin persona, atribuible. Las demás circunstancias son **indicadores** (`drvFlags`: Cliente sin Grupo BC, sin `user_id`, persona por nombre, conflicto nombre/ID, interno...) que no suman horas. El resumen comprueba que la suma de la partición coincide con las filas y minutos válidos (`reconciled`).
- En un lote completado el resumen y el detalle salen de los registros materializados (indexados); antes de activar, de la derivación en vivo sobre el staging.

## Relaciones tardías y reproceso

- **Automático**: activar o revertir tickets recalcula la atribución de los tiempos de esos tickets (`rederiveEntries`), incluido un cambio de organización o de causa, sin releer el log. Solo se escribe (y se versiona: `drvVersion`, `drvAt`, `drvBatchId`) lo que cambia.
- **Manual**: «Reprocesar» sobre un lote **completado** encola un trabajo `REDERIVE` (nuevo valor de `UploadJobKind`; reclamación, lease y fencing como el resto): recalcula con los maestros actuales sin tocar archivo, filas, fechas ni observaciones. Sobre `READY`/`REJECTED`/`FAILED` mantiene el comportamiento del motor (relee el archivo). Audit `REPROCESS`.
- Ambas escrituras toman un bloqueo consultivo común (`csapp-zd-derive`) para que ningún derivado quede obsoleto por una carrera entre la activación de tickets y la de tiempos.

## Extensiones del motor

`HeaderMatch.context/notes`, `parseRow(cells, context)`, `selectsSheet`, `blocksConfirmOnErrors`, `entityConflictPolicy: "conflict_all"`, `postPrepare`, `rederive` y el trabajo `REDERIVE`, `ActivationContext.batch` (fechas del lote), `headerOnly` del lector XLSX y exclusión de `PENDING_DECISION` de las procedencias. El perfil sintético y las garantías de CSAPP-02 (lease, fencing, activación atómica, aislamiento de bases de test) no cambian.

## Diferencias justificadas con el Excel

| Tema | Excel | Aquí | Motivo |
| --- | --- | --- | --- |
| Infraestructura | Cuatro causas de aplicación | Más `incidente_infraestructura` solo con alojamiento CLOUD a la fecha | Ampliación decidida en el contrato (ZDT 07): no aplicar el CLOUD actual a años anteriores |
| Correcciones | Sin tratamiento | Advertencia por `id`+contexto y decisión explícita; nunca por parecido | Sin ID estable no se puede prometer detección automática |
| Estado | Solo el último export | Observaciones con fecha y vigencia por observación | El estado es una observación, no una fecha de cierre |
| Alcance de fechas | Año en curso en finanzas | Todos los registros incluidos, sin filtrar por año | El intervalo declarado describe cobertura, no ordena borrar |

## Rendimiento: lecciones medidas

A escala (≈114 000 tickets y ≈250 000 tiempos) aparecieron dos planes cuadráticos que las pruebas pequeñas no revelan; ambos se corrigieron y la [validación](../validacion/csapp-03.md) mide el resultado:

1. Una sentencia que **lee de la misma tabla en la que inserta** (`NOT EXISTS`/`LATERAL` sobre `ZdTicketRevision`) obliga a recorrer una tabla que crece durante la sentencia. Las revisiones se calculan ahora en una tabla temporal y se insertan con `ON CONFLICT`.
2. Una derivación cara unida a otro conjunto de cardinalidad desconocida (estadísticas ausentes tras `TRUNCATE` o carga reciente) acaba como interior de un bucle anidado que se reevalúa por fila. La derivación arrastra ahora los campos de la fila (`payload`) y el consumidor no vuelve a unirse con el staging; el recálculo materializa antes la derivación en una tabla temporal indexada.

Además, el motor ejecuta `ANALYZE "UploadStagedRow"` al terminar de cargar el staging y la detección de claves contradictorias usa agregación y ventanas (O(n)) en lugar de una autounión. Regla para futuros importadores: no leer en una sentencia la tabla que se escribe, no unir una derivación cara por clave y comprobar el plan con un lote del tamaño del origen.

## Límites y pendientes

- Los desgloses de servicio (SOPORTE, ADMIN_DELEGADA, OTROS), producto y los seis indicadores se calcularán en entregas posteriores con estos datos; aquí quedan disponibles equipo, nivel y PMO a la fecha del trabajo, causa, entorno, Admin delegada, tags/destinos y el alojamiento por vigencia.
- La parte PMO desde 2025 llegará de Wrike (CSAPP-04); los vínculos de tickets con Work Items de producto también.
- La ficha no enlaza el detalle de un ticket antes de activar el lote (todavía no existe).
- Un lote con errores obligatorios no se «arregla» en sitio: se corrige el XLSX, se sube de nuevo y se cancela el anterior.
- Una previsualización de un lote enorme recalcula la derivación en vivo en cada consulta; tras activar, el resumen sale de los registros indexados.
- No probado en Windows. Interpretaciones pendientes de aceptación: ver ZDT 11-13 y ZTM 06-08.
