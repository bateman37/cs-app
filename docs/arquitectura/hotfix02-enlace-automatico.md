# HOTFIX-02 (datos): enlace automático, propagación, servicio y cobertura

Contrato dueño de las uniones y de la propagación automática de [CSAPP-HOTFIX-02-v1](../../prompts/CSAPP-HOTFIX-02-v1.md) §2–§5, §10 y §11 en lo que afecta a datos. Las vistas (Comparativa, Análisis Cliente, Calidad) las documentan sus propios contratos. Migración: `20261110090000_hotfix02_enlace_automatico` (incremental). Validación: [hotfix-02-datos](../validacion/hotfix-02-datos.md).

## 1. Dueño de cada unión

CLIENTES.xlsx es el puente. Las tres columnas «GRUPO CLIENTE VINCLE» acompañan cada una a SU clave externa; ninguna sustituye a otra y no se une por parecido ni por D.

| Fuente | Ruta | Resultado |
| --- | --- | --- |
| Finanzas | denominación BC → equivalencia `BC·GROUP_KEY` | Grupo; el ingreso no se reparte entre Clientes |
| Tickets Zendesk | `organization_id` → C → Cliente D → Grupo F (`ZENDESK·ORG_ID`) | Cliente y Grupo, a la fecha de creación |
| Tiempos Zendesk | `ticket_id` → ticket vigente → su organización → Cliente/Grupo; persona por alias | derivado `drv*` de `ZdTimeEntry` |
| Wrike | proyecto → A/B (`WRIKE·PROJECT_NAME` a **Grupo**); ticket explícito/único del título aporta Cliente compatible | `GROUP_ONLY` sin ticket; `CLIENT` con ticket; conflicto si el ticket contradice |
| PAP | proyecto → I/J (`PAP·PROJECT_NAME`: implantación si hay un único Cliente de su Grupo; si no, Grupo) | `IMPLEMENTATION`/`GROUP_ONLY`; un PAP cuenta una vez |
| Bugs | solo vínculos explícitos a tickets | sin cambios |

Reglas del libro: admite UNA hoja CLIENTES (PERSONAL y PERSONAL PMO opcionales; no se vacía Personal por no venir). Un ID Zendesk con nombres o Grupos distintos **no es un error de fila**: no se crea ese Cliente ni se elige uno (aviso `ID_ZENDESK_CONFLICTO`), pero los alias Wrike y PAP de esas filas se cargan. Un nombre PAP cuyo Grupo J no coincide con el F del Cliente se atribuye al Grupo J sin implantación.

### Alias de varios Grupos

No crean equivalencia. Se guardan como `AliasCandidate` (alias → Grupos candidatos). Un hecho se resuelve solo si **su propio registro** lo identifica: Wrike con ticket cuya organización pertenece a un candidato (`ALIAS_RESOLVED_BY_TICKET`); PAP con tickets vinculados que dan un único candidato (`drvVia = TICKET_ALIAS`). Si el ticket apunta a otro Grupo es conflicto concreto (`SCOPE_CONFLICT`); sin evidencia queda `NO_SCOPE` + `ALIAS_AMBIGUOUS` (PAP: `AMBIGUOUS`). Nunca se elige el primero ni se bloquean los demás alias. Una decisión del administrador crea la equivalencia y prevalece.

### Normalización única

`normalizeName` (Unicode NFC, espacios incluidos los no separables recortados y colapsados) y `nameKey` (además minúsculas) en `src/domain/normalize.ts`; gemela SQL `csapp_norm_name(text)` creada por la migración. Se usa al escribir `searchValue` (equivalencias, alias, asignaciones de servicio, claves BC) y en TODAS las derivaciones SQL (Zendesk, Wrike, PAP, servicio). No se quitan acentos, puntuación ni palabras. IDs Zendesk: texto decimal exacto. Límite: `lower()` de PostgreSQL depende de la configuración regional de la base (UTF-8 esperado).

## 2. Actualización automática de relaciones

Modelo `RelationRefresh` (una fila `global`): `requestedGeneration`, `completedGeneration`, estado `IDLE|PENDING|RUNNING|FAILED`, lease/fencing, progreso, último error e informe.

- **Disparo:** disparadores por sentencia en `ClientGroup, Client, Implementation, ExternalIdentity, ServiceTerm, Person, PersonAlias, PersonTerm, StaffCatalogItem, AliasCandidate` suman 1 a `requestedGeneration`. Cubre la precarga, ediciones manuales y decisiones sin código aplicativo adicional; un cambio durante un recálculo no se pierde.
- **Ejecución:** el trabajador existente (`runOnce`) reclama la fila cuando no hay cargas pendientes. Una transacción, bajo el bloqueo de derivación compartido, recalcula por conjuntos (sin N+1): tiempos Zendesk, tiempos Wrike, PAP, vínculos Work Item–ticket y atribución financiera de todos los lotes (sin límite de lotes). Solo escribe lo que cambia (idempotente). Conserva orden de recepción, ganadores, observaciones, fechas y snapshots; las instantáneas sustituidas se recalculan pero no se reactivan.
- **Coherencia:** publica `completedGeneration = g` (la generación tomada al empezar); si ya hay una mayor queda `PENDING` y se repite. Una tarea antigua nunca declara «al día» un estado calculado con un maestro anterior. Todo o nada: un fallo, la detención del trabajador o la pérdida del lease deshacen la transacción.
- **Conciliación:** antes/después de filas, minutos, PAP únicos, tickets, filas e ingresos financieros; si difieren, se aborta. El informe (solo cifras) clasifica coincidencias exactas, enriquecidas, solo Grupo, ambiguas y sin correspondencia.
- **Administración:** estado «Actualizando relaciones» (progreso, intento, fallo) en el menú de Administración y en Cargas; acción única «Actualizar relaciones de los datos cargados» (`requestRepair`, solo Admin, auditada, idempotente). La antigua lista «Reproceso necesario» (máx. 100 lotes) desaparece.
- **Migración:** crea el esquema y deja programada la reparación (`MIGRACION_HOTFIX02`, generación 1) si hay lotes completados; no recalcula filas. El trabajador la ejecuta y el estado es verificable en `RelationRefresh`.

## 3. Clasificación del servicio (`servicio-v2`)

Compartida por motor, ficha, detalles, Calidad, Pulse y exportaciones (`SERVICE_OF_SQL`). Evidencias explícitas (Administración Delegada del ticket, asignación por Entorno y Tipología, por proyecto Wrike) se conservan y sus conflictos reales también. **Solo sin evidencia explícita:**

1. Ticket con Entorno y Tipología informado que no es Administración Delegada → `SOPORTE` (origen `ENTORNO_ORDINARIO`).
2. Wrike (único perfil vigente de mantenimiento/soporte N3) con proyecto reconocido (Cliente o Grupo atribuido), persona PMO elegible y sin ticket de Administración Delegada → `SOPORTE` (origen `WRIKE_MANTENIMIENTO_N3`).
3. Sin evidencia ni relleno aplicable → `SIN_CLASIFICAR`.

La causa desconocida no borra horas de soporte válidas; el corte PMO sigue por fecha del trabajo.

## 4. Cobertura de Calidad y carga amplia

`BROAD_EXPORT_CONTRACT` (`src/domain/quality-coverage.ts`): un lote completado, no heredado (`legacyBase = false`) y sin declaración explícita hereda cobertura «todos los clientes» (tickets: todos los estados) desde el origen de la fuente hasta la extracción declarada o, si falta, la recepción (observación operativa). El inicio **no** se infiere de `MIN(fecha)`. En tiempos solo cuenta la instantánea activa. Una declaración explícita prevalece siempre; lo heredado sin declaración sigue desconocido. `Coverage.provenance` (`DECLARED|SOURCE_CONTRACT|NONE`) hace trazable el origen. El stock de un export recibido hoy sustenta el corte de hoy; nunca reconstruye un corte anterior (`chooseSnapshot`). Límite: un export filtrado en la fuente no es detectable; la declaración explícita del Administrador lo corrige.
