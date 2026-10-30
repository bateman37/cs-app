# Motor común de cargas: contrato (CSAPP-02)

Implementa [IMP 01–07](../importaciones/proceso-comun.md). Los importadores operativos son Tickets y Tiempos Zendesk (CSAPP-03, ver [decisiones técnicas](zendesk-csapp03.md)); Wrike, PAP y bugs llegan en 04 y finanzas en 05. Un perfil sintético ejercita el motor en pruebas. Operación del trabajador y recuperación: [guía del trabajador](../plan/guia-trabajador-cargas.md). Lectores XLSX/CSV: ver su documento propio.

Estado: **implementado y probado en Linux** con PostgreSQL real (ver [validación](../validacion/csapp-02.md)); no probado en Windows; no aceptado por Dennis.

## Piezas

| Pieza | Dónde | Papel |
| --- | --- | --- |
| Web (Next.js) | `src/app/api/cargas/**`, servicios `src/server/uploads/batches.ts` | Autoriza, recibe el archivo en streaming, encola, expone consultas y acciones. Nunca sostiene trabajo en segundo plano |
| Trabajador | `scripts/worker.ts` → `worker-dist/worker.mjs` | Proceso separado: reclama trabajos de la cola, prepara y activa |
| Cola, estado y progreso | PostgreSQL (`UploadJob`, `UploadBatch`) | Sin Redis. Reclamación atómica `FOR UPDATE SKIP LOCKED` |
| Staging | `UploadStagedRow` | Filas leídas, tipadas y clasificadas; no altera datos activos |
| Procedencias | `UploadRecordSource` | Qué lote aportó qué fila (por huella) |
| Archivos | `CSAPP_UPLOAD_DIR` (`files/<uuid>`, `incoming/<uuid>.part`) | Privados, fuera de `public` y de Git, compartidos por web y trabajador |

## Estados y transiciones

`RECEIVING → QUEUED → PREPARING → READY → ACTIVATION_QUEUED → ACTIVATING → COMPLETED`; salidas `REJECTED`, `FAILED`, `CANCELLED`, `REVERTED`. «Confirmación» es la transición `READY → ACTIVATION_QUEUED` (encola el trabajo de activación en la misma transacción).

| Desde | Hacia | Quién / cuándo |
| --- | --- | --- |
| (alta) | RECEIVING | Servicio `receiveUpload`, tras autorizar y validar perfil, formato, metadatos y límites |
| RECEIVING | QUEUED | Archivo completo (fsync + rename), checksum y trabajo `PREPARE` en una transacción |
| RECEIVING | REJECTED | Límite superado, subida interrumpida o caducada (mantenimiento del trabajador) |
| QUEUED | PREPARING | El trabajador reclama `PREPARE` |
| PREPARING | READY | Preparación terminada (contadores, resumen, `rulesSnapshot`) |
| QUEUED/PREPARING | REJECTED | Cabeceras/estructura/formato inválidos, archivo vacío, perfil no disponible, límite del lector |
| READY | ACTIVATION_QUEUED | `confirmUpload` (compare-and-set + versión opcional) |
| ACTIVATION_QUEUED | ACTIVATING | El trabajador reclama `ACTIVATE` y **confirma** este estado antes de la transacción de activación |
| ACTIVATING | COMPLETED | Transacción única de activación (datos, procedencias, estado, auditoría) |
| ACTIVATING | QUEUED | Reglas, versión de perfil o maestros cambiaron desde la previsualización: se revalida sin aplicar nada |
| cualquiera no terminal | FAILED | Intentos agotados (3 por defecto) o error no reintentable |
| RECEIVING/QUEUED/READY/ACTIVATION_QUEUED | CANCELLED | `cancelUpload` |
| PREPARING | CANCELLED | `cancelUpload` marca `cancelRequested`; el trabajador se detiene entre bloques |
| READY/REJECTED/FAILED | QUEUED | `reprocessUpload` (reutiliza el archivo original) |
| COMPLETED | COMPLETED | `reprocessUpload` con perfil que admite recalcular: encola `REDERIVE` (recalcula lo derivado sin releer el archivo; el lote no cambia de estado) |
| COMPLETED | REVERTED | `revertUpload` encola `REVERT`; transacción atómica |

Acciones por estado (fuente única: `src/domain/cargas.ts`, `availableActions`): **Confirmar** solo en READY; **Cancelar** antes de ACTIVATING (en ACTIVATING la interfaz explica que esa fase aplica los cambios en una transacción atómica, que no se cancela con una petición y que un fallo la deshace por completo); **Reprocesar** en READY/REJECTED/FAILED (y en COMPLETED si el perfil declara `rederive`); **Revertir** solo en COMPLETED si el perfil lo admite y, con sustitución por ámbito, solo el lote vigente. El cliente no envía estados: cada acción es una función de servidor con compare-and-set sobre el estado.

## Contadores (ficha del lote)

Definiciones en `COUNTER_DEFINITIONS` (`src/domain/cargas.ts`): **recibidas** (filas de datos no vacías); **con error** (≥1 error; no se activan); **válidas** = recibidas − con error (incluye duplicadas, excluidas, revisadas y nuevas); **duplicadas** (idénticas a una anterior del archivo o ya aportadas por un lote vigente); **excluidas** (válidas fuera del cálculo por relación no resuelta, con motivo); **revisadas** (clave de entidad existente con contenido distinto); **avisos** (≥1 aviso; una fila excluida lleva un aviso con su motivo); **importadas** (solo tras activar). Se recalculan con SQL de agregación. Sin total fiable no hay porcentaje: la ficha muestra `rowsProcessed` y la fase.

## Tres identidades distintas

1. **Checksum del archivo** (SHA-256 del contenido): detecta el mismo archivo, solo avisa; subirlo otra vez crea otro lote y no duplica registros.
2. **Huella de fila** (SHA-256 del JSON canónico de **todos** los campos fuente tipados; claves ordenadas; sin lote, posición ni nombre de archivo; antes de enriquecer con maestros). La normalización la hace el perfil (fechas ISO, decimales como texto sin ceros a la derecha, espacios repetidos colapsados).
3. **Clave de entidad revisable** (`entityKey`, opcional): el perfil declara qué identifica una entidad que puede cambiar de contenido.

Deduplicación por **(perfil, ámbito, huella)** — el ámbito (`scopeKey`) separa productos, años o categorías—; nunca solo por ID. Dos filas idénticas, en el mismo archivo o en archivos distintos, se materializan una vez; `UploadRecordSource` relaciona cada lote con las huellas que aportó y cuántas veces. Una clave repetida con contenido distinto es **revisión** (política `entityConflictPolicy: "revision"`, por defecto) o **conflicto** (`"conflict"`: las filas posteriores del mismo archivo son errores). La regla específica de tickets o logs sin ID queda para CSAPP-03.

## Contrato de perfil (`src/server/uploads/profile.ts`)

Definido en servidor; no se admite código, SQL ni expresiones subidas por el usuario. Un perfil declara: `id`, `label`, `version`, `formats`, `delimiter`/`sheet`, `policy` (`INCORPORATE` | `REPLACE_SCOPE`), `metadataFields` + `metadataSchema` (metadatos exigidos al subir), `scopeKey`, `matchHeaders` (identifica esquema/cabeceras y versión), `parseRow` (lee y tipa; devuelve `typed`, incidencias `error|warning`, `entityKey`, `exclude`), `entityConflictPolicy`, `rulesFingerprint` (reglas y versiones de maestros relevantes), `activate` y `revert` (escritura de su ámbito dentro de la transacción del motor). El motor aporta lectura por bloques, staging, huellas, contadores, procedencias, cola, bloqueo del ámbito y auditoría.

Errores de estructura/unidad/fecha obligatoria → fila `ERROR` (no se activa lo inválido). Relación no resuelta → `EXCLUDED` con motivo, conservando el bruto; sin asignación por similitud y sin bandeja aparte.

## Activación

Un único trabajo `ACTIVATE` por lote (índice único parcial). El reclamo confirma `ACTIVATING`; después **una transacción**: protección por fencing; bloqueo `FOR UPDATE` del lote; re-autorización del actor del trabajo (Administrador activo; generado en servidor al encolar, nunca enviado por el cliente); `pg_advisory_xact_lock(perfil|ámbito)` (bloquea activaciones incompatibles del mismo ámbito, sin bloqueo global); comprobación de obsolescencia (`profileVersion` y `rulesFingerprint` frente al snapshot del lote); disposiciones por SQL de conjuntos (`NEW`, `DUPLICATE_EXISTING`, `REVISION`); `profile.activate`; procedencias; contadores; estado `COMPLETED`; trabajo `DONE`; auditoría. Un fallo hace rollback total: los datos activos anteriores quedan íntegros y el trabajo se reintenta con espera acotada hasta agotar intentos.

Políticas: **INCORPORATE** (incorporación/revisión por procedencias; revertir el lote A **no** elimina una fila que también aporta otro lote vigente; orden de reversión indiferente) y **REPLACE_SCOPE** (sustitución atómica del ámbito: el lote vigente previo queda supersedido —`supersedesBatchId`/`supersededByBatchId`—; los demás ámbitos no se tocan; revertir restaura el conjunto anterior desde el staging conservado y solo es posible para el lote vigente).

## Cola, reclamación, lease y fencing

`claimNextJob`: `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`, que incrementa `fence` e `attempts` y fija `leaseOwner` y `leaseExpiresAt`. También reclama trabajos `RUNNING` con lease vencido (trabajador caído); si agotaron los intentos pasan a `FAILED` junto con el lote. El latido extiende el lease solo si propietario y `fence` coinciden. **Toda escritura del trabajador** (bloques de staging, checkpoints, estado final) comienza con `assertFence`, que bloquea la fila del trabajo y exige el mismo propietario y token: un trabajador antiguo no escribe nada tras perder el trabajo. Fallos: reintento con espera exponencial acotada o `FAILED`; nunca «en ejecución» eterno ni bucles infinitos. Cierre ordenado (SIGINT/SIGTERM): el trabajo vuelve a `PENDING` sin consumir intento y conserva su checkpoint.

## Preparación reanudable

Lee con `readRows` por bloques (1000 filas por defecto), valida con el perfil e inserta el staging con `checkpointPosition` y `rowsProcessed` en la **misma** transacción del bloque. Tras un reinicio vuelve a leer y salta las posiciones ≤ checkpoint; `UNIQUE(batchId, position)` impide duplicados. Si las reglas cambiaron desde el primer bloque, reinicia desde cero. Al terminar: conflictos de clave, duplicados del archivo (función de ventana), disposiciones, contadores y resumen de incidencias, todo por SQL de conjuntos. Memoria acotada: ningún array contiene el archivo ni el staging completos; las listas de la ficha se paginan (`listStagedRows`).

## Almacenamiento y subida

Identificador interno uuid; el nombre original (saneado) es solo informativo. `POST /api/cargas` recibe el **cuerpo como archivo** (sin `formData`): origen → sesión real → rol ADMIN (leído de la base) → perfil, formato, metadatos y límites (`Content-Length`) → solo entonces se abre `incoming/<uuid>.part` y se lee el cuerpo, con límite duro en streaming y SHA-256 incremental; fsync y rename atómico. Un rechazo previo no deja archivo, lote ni trabajo. El nombre o la extensión no validan el contenido: el trabajador comprueba la firma (ZIP para XLSX; sin bytes NUL para CSV) y los lectores validan la estructura. `src/proxy.ts` excluye `api/cargas` porque el proxy bufferiza cuerpos; las rutas validan por sí mismas. `GET /api/cargas/[id]/estado` y `/archivo` (descarga) exigen ADMIN.

Metadatos separados: fecha de carga (`createdAt`), extracción declarada, intervalo declarado y cobertura conocida, más los del perfil. La extracción nunca se deduce de `MAX(fecha_creación)`.

### Tratamiento de ficheros

| Fichero | Tratamiento |
| --- | --- |
| `incoming/*.part` de subidas interrumpidas | El servicio lo borra al fallar; el mantenimiento del trabajador rechaza los lotes `RECEIVING` caducados (60 min) y borra el parcial |
| Archivos de lotes activos, completados, rechazados o cancelados | **Se conservan** (trazabilidad y reproceso). No hay política de borrado aprobada: no se borra nada automáticamente |
| Staging | Se conserva con el lote (la reversión por sustitución lo necesita); se reinicia al reprocesar |
| Exposición | Nunca públicos; solo descarga autorizada para Administrador |

## Perfil sintético (solo pruebas)

`sintetico-incorporar` y `sintetico-sustituir` (ámbito A/B). Código en `src/server/uploads/synthetic/` (necesario para que web y trabajador construidos puedan registrarlo) pero **inerte**: solo se registra si (1) `CSAPP_ENABLE_SYNTHETIC_PROFILES` es igual al nombre exacto de la base conectada, (2) ese nombre acaba en `_test` y (3) existe el esquema `csapp_synthetic` con su fila marcador. Sus tablas viven solo en la base de test (`tests/synthetic/schema.ts`); no hay migración de producción para ellas y en producción no aparecen. No se activa por parámetro del navegador ni solo por prefijo.

## Configuración

Ver `.env.example`: `CSAPP_UPLOAD_DIR`, `CSAPP_UPLOAD_MAX_BYTES`, `…_MAX_UNCOMPRESSED_BYTES`, `…_MAX_RATIO`, `…_MAX_ROWS`, `…_MAX_SHARED_STRINGS_BYTES`, `…_MAX_CONCURRENT` (429), `…_MAX_OPEN_BATCHES`, `…_INCOMPLETE_MINUTES` y los `CSAPP_WORKER_*` (lease, latido, sondeo, intentos, bloque, espera).

## Extensiones de CSAPP-03

Opciones de perfil añadidas sin cambiar las garantías anteriores: `HeaderMatch.context` y `notes` (el orden de columnas viaja a `parseRow(cells, context)` y las columnas adicionales se informan en el resumen), `selectsSheet` (con XLSX de varias hojas compatibles exige el metadato `hoja`; el lector inspecciona solo la primera fila de cada hoja con `headerOnly`), `blocksConfirmOnErrors` (no se confirma con errores obligatorios sin resolver), `entityConflictPolicy: "conflict_all"` (todas las filas de una clave contradictoria son error), `postPrepare` (hook dentro de la transacción de preparación), `rederive` y el trabajo `REDERIVE`, y `ActivationContext.batch`. Las filas con disposición `PENDING_DECISION` no se registran como procedencia. Valores nuevos: `UploadJobKind.REDERIVE`.
