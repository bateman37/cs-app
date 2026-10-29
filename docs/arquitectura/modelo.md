# Modelo de datos lógico

## Identidad y vigencia

| Entidad | Granularidad y relaciones |
| --- | --- |
| ClientGroup | Un grupo económico BC con identidad interna estable |
| Client | Identidad de cliente/organización relacionada con Grupo Cliente, usando las vistas existentes |
| ClientImplementation | Implantación opcional con clave real; no se crea una por cada fila repetida de búsqueda |
| ExternalIdentity | Sistema, tipo, valor externo, grupo o proyecto y vigencia sin solapamiento |
| ServiceAgreement | Cliente o proyecto, soporte, alojamiento, complejidad, producto y vigencia |
| ProjectMilestone | Fecha de arranque, migración cloud o cambio de versión mayor |
| Person y PersonAlias | Persona única y alias/IDs por sistema |
| PersonAssignment | Equipo, nivel, PMO y rol vigentes en un intervalo |
| ClientUsersMonth | Ámbito grupo/proyecto, año, mes, usuarios, origen y revisión; clave única mensual sin duplicar el total entre niveles |

## Fuentes y hechos

| Entidad | Granularidad y relaciones |
| --- | --- |
| ImportBatch y ImportFile | Fuente, checksum, esquema, ámbito, extracción, cobertura, usuario, estado y archivo |
| RawRecord y BatchRecord | Fila original y su relación con uno o varios lotes; huella única por fuente/ámbito |
| ImportIssue | Campo, fila, error, propuesta y resolución auditada |
| Ticket y TicketRevision | ticket_id, organización/Cliente, fecha_creación, type, status, entorno/tipología y causa; revisiones con observación y lote; no hay descripción, fecha de cierre o problem_id |
| TicketStatusObservation | Estado observado, extracción declarada y carga, cobertura, lote y orden de revisiones; sin inventar fecha de transición |
| TicketTagObservation | Conjunto de tags observado en una revisión; fecha observada, sin inventar evento de escalado |
| TimeEntry y TimeEntryRevision | Registro de dedicación, fecha, duración, persona, ticket/proyecto, fuente, elegibilidad y versión |
| RevenueSnapshot y RevenueLine | Año, categoría, cliente, importe y semántica; una versión activa del ámbito sustituible |
| RevenueLine.budgetDifference | Diferencia contra Budget conservada sin sumarse al ingreso; sin modo de carga incremental |
| ProductionPass y PassRevision | PAP único por ámbito de lista e ID, datos de ejecución y revisiones |
| PassTicket y PassCategory | Relaciones múltiples que no multiplican intervenciones |
| ProductWorkItem y ProductSnapshot | ID y tipo por producto, estado original, alcance de la vista, observación y presencia en cada fotografía; ausencia no cierra ni borra |
| BugTicketLink | Relación explícita múltiple entre Work Item Bug_ y ticket Zendesk; origen columna o URL, interno/externo, sin inferir parentesco |
| DiagnosisFamily y DiagnosisEvidence | Familia derivada de causa, señal de entorno y evidencia de vínculo a producto guardadas por separado |

## Análisis y configuración

| Entidad | Granularidad y relaciones |
| --- | --- |
| HealthFeedback y ClientHealthMonth | Evidencias y valoración mensual explícita |
| RuleSetVersion | Clasificación de causas, servicios, tags, fuentes y periodos |
| QualityConfigVersion | KPI, dirección, método, cohortes, límites, pesos y salvaguardas |
| MonthlyAggregate | Totales y denominadores por ámbito, con versión de datos |
| MetricResult | Numerador, denominador, unidad, valor, estado de cobertura y procedencia |
| QualityResult | Referencia, límites, riesgo, color, motivo y pesos efectivos |
| AnalysisClose | Corte publicado opcional (no se exige para consultar el mes en curso) que fija revisiones de fuentes, maestros y reglas |
| AuditEvent | Quién cambió qué, cuándo, por qué y antes/después |

## Restricciones

Una identidad externa no apunta a varios clientes al mismo tiempo. Una línea monetaria de grupo no se suma de nuevo por cada proyecto. Una entrada de tiempo tiene una sola fuente elegible para su ámbito histórico. El total de tickets y PAP se calcula antes de los joins de categorías. El estado activo de una revisión no elimina el bruto anterior. La reversión de un lote tiene en cuenta si otro lote vigente también aportó la fila.

Guardar IDs externos como texto o enteros exactos, nunca floats. Propuesta técnica inicial: numeric de precisión suficiente para cantidades monetarias y horas, acordada con el benchmark y rango de fuentes; no redondear a dos decimales al ingerir. Las fechas sin hora se guardan como fechas; los instantes con zona se guardan como timestamps y se presentan en Europe/Madrid. No desplazar una fecha de dedicación por interpretar su hora Excel como UTC.

Los agregados son derivados y se pueden reconstruir. Los cierres conservan referencias o materializaciones suficientes para reproducir el resultado con las versiones anteriores. El diseño físico definitivo deberá detallar índices, claves y estrategia de versionado antes de la migración; este modelo no es todavía un esquema Prisma implementado.
