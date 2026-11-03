# Pulse Rent y configuración: decisiones técnicas de CSAPP-07

Implementado en [CSAPP-07](../../prompts/CSAPP-07-v1.md). Las reglas de negocio no se copian aquí: [Pulse Rent](../producto/pulse-rent.md) (PUL 01-05, catálogo M01-M38), [fórmulas CAL 37-44](../calculos/catalogo.md), [Administración](../producto/administracion.md) (ADM 12-15), [Calidad](../producto/calidad.md) y [backlog](../producto/backlog-antiguedad.md). Base: cabeza de la PR 7 (CSAPP-06).

## 1. Esquema (migración `20261102090000_pulse_calidad_configuracion`)

Incremental; no modifica ninguna tabla anterior y la economía conserva `EconomicSettingsRevision`.

| Tabla | Contenido |
| --- | --- |
| `ConfigRevision` | `family` (`PULSE`/`QUALITY`), `revisionNo` único por familia, `payload` JSONB, `reason`, `kind` (`INITIAL`/`ACTIVATION`/`ROLLBACK`), `restoredFromRevisionNo`, autor y fecha. CHECK de familia, tipo, número y de que solo un `ROLLBACK` identifica su origen. Disparador `BEFORE UPDATE OR DELETE` que lo impide: **revisiones inmutables** |
| `ConfigDraft` | Un borrador por familia: `payload`, `baseRevisionNo`, `version` (detecta edición obsoleta), nota y autor |

No hay semilla: la configuración inicial vive en código (`defaultPulseConfig`, `defaultQualityConfig`). Una lectura sin revisión persistida devuelve la revisión 1 **en memoria** (`persisted: false`) y **nunca escribe**; la primera activación persiste la revisión 1 y crea la 2.

## 2. Contratos tipados

`src/domain/pulse-catalog.ts` (catálogo, referencias, perfiles, `pulseConfigSchema`) y `src/domain/quality-config.ts` (pesos, reglas, composición, global, `qualityConfigSchema`, simulador). El `payload` se valida con zod (estructura cerrada: sin fórmulas ni JSON arbitrario) y con validadores semánticos antes de guardar un borrador y de activar. `src/server/pulse/config.ts` ofrece `getActive`, `saveDraft`, `activateDraft`, `rollbackTo`, `discardDraft`, `listRevisions` y `getManifest`; la activación toma un bloqueo asesor por familia, comprueba `expectedRevisionNo` y `expectedDraftVersion`, crea la revisión, borra el borrador y audita en la misma transacción. `src/server/pulse/forms.ts` convierte los formularios en borradores (funciones puras).

**Sello de datos.** El dominio `configuracion` del sello de CSAPP-06 pasa a ser el manifiesto `economía|Pulse|Calidad` de revisiones activas: activar otra configuración cambia la referencia de datos e invalida las lecturas y bandas anteriores.

## 3. Servicio analítico (`src/server/pulse`)

`getPulse` abre **una** instantánea `REPEATABLE READ` (la de CSAPP-06), lee la configuración y calcula: (1) referencias (membresía por criterios sobre los metadatos vigentes al corte); (2) entidades del ámbito (grupo, cliente, implantación); (3) una llamada del motor económico por conjuntos (`economicsInTx`, ampliado con los ámbitos `clients` e `implementations`); (4) hechos operativos por conjuntos, una sentencia por familia (horas por perfil y clase, tickets y escalados, PAP, cobertura de fuentes); (5) celdas, estadística de **toda** la referencia antes de paginar, bandas, orden y página. Sin consultas por celda, cliente ni percentil.

**Mismos predicados para resumen y detalle** (`sql.ts`): `classifiedActivitySql`, `ticketSetSql`, `papSetSql` y `papPredicate` alimentan el agregado, el detalle paginado (`detail.ts`) y el CSV (`export.ts`). Los perfiles se resuelven por selectores canónicos con prioridad (una actividad cuenta en el primer perfil que la captura). Tickets y escalados no se atribuyen a implantaciones.

**Cobertura.** Un cero solo se publica con la fuente relevante presente en el periodo (`sourceCoverageSql`: tiempos Zendesk/Wrike, tickets, PAP); sin ella, dato ausente. Valores parciales (horas sin clasificar, elegibilidad pendiente, perímetro de servicio incierto) se conservan, no se colorean y no entran en la referencia.

**Estado de la URL.** `src/domain/pulse-query.ts` valida y serializa: reutiliza el contrato de 06 y añade ámbito, periodo, normalización, referencias (`ref`, `refeco`, criterios copiados `rsoporte`…), revisión de Pulse, columnas, orden, columna/entidad seleccionadas. Valores no válidos vuelven al inicial con aviso; nada se interpola en SQL.

## 4. Seguridad y permisos

Lectura (`authorize READ`) para ADMIN y Consulta en Pulse, explicación, detalle y CSV; escritura (`ADMIN`) comprobada en servidor en cada acción y servicio; el borrador solo lo lee ADMIN. Las rutas CSV exigen sesión real; sin sesión redirigen al acceso. Se exporta el resultado, no los originales de Cargas. El CSV reutiliza BOM, `;`, escape y neutralización de fórmulas de CSAPP-06; los negativos válidos y los decimales exactos no se tocan.

## 5. Prevención de pruebas sobre la base equivocada (§3 del prompt)

Incidente heredado de CSAPP-06: una importación estática dejó un cliente conectado a `cs_app` y una preparación de pruebas vació esa base. Prevención implementada en `src/lib/test-guard.ts`: destino explícito `TEST_DATABASE_URL` con nombre `cs_app…_test` tomado **solo del path** y distinto de la base de trabajo (ni `NODE_ENV=test` ni el nombre en la contraseña o en la query cuentan; parámetros que redirigen la sesión se rechazan); `current_database()` comprobado **en la conexión efectiva** (dentro de la misma transacción que el `TRUNCATE`) antes de cualquier DDL, TRUNCATE, siembra, cuenta o migración de prueba; el entorno se fija antes de importar singletons (`scripts/e2e/entorno-test.ts` es el primer import del recorrido) y `src/lib/db.ts` crea el cliente en el **primer uso**, no al importar, y se niega a conectar a una base distinta de la aprobada. Pruebas negativas con dobles controlados (`tests/guard-pruebas.test.ts`): ninguna ejecuta una operación destructiva sobre `cs_app`. **Esto previene; no limpia.** Los residuos del incidente quedan pendientes de decisión (ver [validación](../validacion/csapp-07.md)).

## 6. Rendimiento

Medido con `npm run benchmark:pulse` (1 500 grupos, 250 000 tiempos, PAP y destinos sintéticos); cifras reales en la [validación](../validacion/csapp-07.md). Cada petición recalcula la referencia completa sin caché (privada o ninguna). Los gráficos reciben distribuciones agregadas, nunca hechos masivos.

## Nota de CSAPP-08: `quality-config-v2`

La carga de Calidad pasa a v2 (reglas por ámbito y unidad, backlog por tipo, política de fotografía y catálogo de diagnóstico). Las revisiones v1 se leen mediante un adaptador documentado en [calidad-csapp08](calidad-csapp08.md) sin actualizar su JSON; una nueva elección crea otra revisión. Siguen vigentes la inmutabilidad, la activación atómica, la vuelta atrás como nueva revisión y la edición obsoleta rechazada. Pulse Rent no cambia.
