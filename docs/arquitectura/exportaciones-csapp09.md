# Exportaciones completas, instantáneas y recuperación (CSAPP-09)

Contrato técnico de la exportación de detalle completo en segundo plano. Implementado en [`src/server/exports/`](../../src/server/exports/); medido en [validación de CSAPP-09](../validacion/csapp-09.md). Estado: **implementado y probado en Linux con datos sintéticos; no aceptado por Dennis; Windows sin probar**.

## 1. Esquema y frontera transaccional (documentado antes de implementar)

Migración incremental `20261104090000_exportaciones_conciliacion` (no toca ninguna tabla anterior; las revisiones inmutables y los datos de 08 se conservan):

| Tabla | Función |
| --- | --- |
| `ExportJob` | Trabajo persistente: solicitante, conjunto, **consulta validada** (JSON), estado (`QUEUED`, `PREPARING`, `GENERATING`, `READY`, `FAILED`, `CANCELLED`, `EXPIRED`), fase, progreso real (filas hechas/totales), versiones de formato y motor, revisiones de configuración y **sello pedido** con sus totales (lo que mostraba la pantalla), materialización (fecha, sello, contexto, filas), lease/fencing (`leaseOwner`, `leaseExpiresAt`, `fence`), intentos, error, caducidad |
| `ExportRow` | **Materialización inmutable**: una fila por registro del archivo (`jobId`, `fileKey`, `seq`, `cells` jsonb de texto) con orden estable. Se escribe una vez y se borra al caducar |
| `ExportFile` | Archivo terminado y validado: UUID interno de almacenamiento, nombre, filas, bytes, SHA-256, si sus filas son aditivas y su tipo (datos o manifiesto) |
| `ReconRun` | Ejecución registrada de la conciliación (ver [contrato](../validacion/conciliacion-contrato.md)) |

**Fronteras transaccionales.**

1. *Solicitud* (petición web): una transacción `REPEATABLE READ` de solo lectura calcula, con el sello de datos y los mismos conjuntos SQL que usará el trabajador, los totales por archivo; después se inserta el `ExportJob` (`QUEUED`). No se genera nada dentro de la petición ni se lanza una tarea que se olvide.
2. *Preparar* (trabajador): **una** transacción `REPEATABLE READ` cuya primera sentencia es `SELECT … FOR UPDATE` del trabajo (fija la instantánea y el **fencing**). Dentro: autoriza al solicitante, borra restos, resuelve ámbito/fotografía/umbrales y ejecuta `INSERT INTO "ExportRow" SELECT row_number() OVER (ORDER BY …), to_jsonb(ARRAY[…]) FROM (<conjunto>)` por archivo (set-based: la memoria de la aplicación no crece con las filas), lee sello y revisiones y actualiza el trabajo (`materializedAt`, contexto, totales, `GENERATING`). Todo confirma junto o nada: **membresía, metadatos, valores, etiquetas y denominadores** quedan fijados en la misma lectura, no una lista de IDs cuyos registros cambian después. La transacción termina antes de generar el archivo y **nunca** se mantiene abierta durante una descarga del navegador.
3. *Generar* (trabajador, sin transacción larga): lee `ExportRow` por bloques con clave `seq` (cursor sobre una materialización inmutable), escribe CSV con contrapresión (`write` + `drain`) y SHA-256 incremental a un temporal propio del intento, verifica, `fsync` y `rename` atómico al nombre definitivo (UUID derivado del trabajo/archivo/parte). El progreso se confirma por bloque con fencing y comprueba la petición de cancelación.
4. *Publicar*: una transacción final con fencing registra `ExportFile` (upsert idempotente) y marca `READY` con la caducidad. Solo entonces el archivo es descargable.

**Si la lectura cambió respecto a la pantalla** (sello distinto al pedido), el trabajo conserva **ambos** sellos, fechas y totales y se muestra «lectura posterior a la pantalla»; el manifiesto lo declara. No se finge haber recuperado una instantánea antigua. Una materialización **completada** se reutiliza al reintentar (mismo estado); si el intento falló antes de completarla, la transacción se revirtió y el nuevo intento registra su nueva lectura.

## 2. Conjuntos y contratos de columnas

Cada archivo declara columnas con tipo y unidad, granularidad, clave, orden, regla de conciliación y si es **aditivo** ([`datasets.ts`](../../src/server/exports/datasets.ts), copiado al manifiesto del trabajo). Ningún predicado procede del cliente: solo parámetros validados (conjunto, ámbito, entidad, periodo, servicio).

| Conjunto | Archivos | Aditivo | Regla resumida |
| --- | --- | --- | --- |
| `horas` | `horas` (una fila por `(fuente, id_entrada)`) | Sí | Σ minutos = fuente; ELEGIBLE + PENDIENTE + EXCLUIDA = total; exclusiones y desconocidos conservados con motivo; sin Grupo = grupo vacío |
| `tickets` | `tickets`, `backlog` | Sí | Un ticket una vez; `es_n3` es la unión, `n3_pmo`/`n3_it` desgloses no aditivos; Σ `afectacion_union` = numerador del sexto indicador; backlog = activos de la fotografía compatible (vacío con motivo si no hay) |
| `pap` | `pap`, `pap_causas` | `pap` sí; `pap_causas` **no** | PAP únicos lista+ID; varias causas no lo multiplican; sin fecha se conserva |
| `bugs` | `problemas_bugs` | **No** | Una fila por vínculo; `cuenta_numerador` marca la única fila que cuenta por problema |
| `finanzas` | `finanzas_lineas` | Sí | Líneas activas por año y categoría; no copia el archivo original ni campos privados de Administración |

Un conjunto que supera `CSAPP_EXPORT_PART_ROWS` (por defecto 1 000 000 de filas de datos, por debajo del límite de una hoja de Excel: 1 048 576 con cabecera) se **parte de forma determinista** por orden de clave en partes `_p001`, `_p002`…; el manifiesto lo avisa y nada se trunca.

**Formato**: CSV UTF-8 con BOM, separador `;`, CRLF, comillas y saltos escapados, decimales con coma (Excel en español); **texto** no confiable que empieza por `= + - @` tab o retorno se neutraliza con apóstrofo; los **números** (decimales exactos) no se tocan, así que un negativo válido sigue siendo número; celda vacía = desconocido, `0` = cero explícito (reutiliza [`src/domain/csv.ts`](../../src/domain/csv.ts)). **Manifiesto JSON** descargable: consulta, ámbito, revisiones, sello y fecha de lectura, pantalla frente a lectura, archivos con filas/bytes/SHA-256, contratos de columnas y avisos.

## 3. Cola, lease, fencing y recuperación

Mismo patrón que las cargas (PostgreSQL, sin Redis), con entidad propia porque `UploadJob` exige un lote y no se inventa un lote sintético:

- Reclamación atómica `FOR UPDATE SKIP LOCKED`; lease con latido; cada reclamación incrementa `fence` y `attempts`; toda escritura del trabajador exige el mismo propietario y token (`assertExportFence`): el trabajador antiguo no confirma.
- Fallo reintentable: reintento con espera acotada; agotados los intentos (o lease vencido sin más intentos) → `FAILED` visible y **recuperable** (botón Reintentar), nunca «generando» eterno. Fallos no reintentables (sin permiso, sin espacio, tamaño máximo) → `FAILED`/`CANCELLED` con mensaje.
- **Caída tras escribir y antes de marcar `READY`**: el siguiente intento regenera desde la materialización con el mismo UUID de destino y los mismos bytes (rename atómico sobre el mismo nombre): sin anexar, sin duplicar filas, sin publicar un parcial. Un trabajador antiguo que escribió tarde solo deja un archivo que **no** está registrado (no se ofrece) y que el barrido de huérfanos elimina.
- **Cancelar**: en cola es inmediato; en ejecución se pide y se resuelve en la siguiente frontera segura (entre bloques o al publicar); una transacción de lectura ya confirmada no se corta y la cancelación no promete lo contrario. Cancelar limpia la materialización; `Reintentar` vuelve a encolar.
- **Caducidad** (`CSAPP_EXPORT_TTL_HOURS`, 24 h): elimina solo artefactos y materialización del propio trabajo, conserva el registro mínimo y **no toca lotes, auditoría ni datos de negocio**. Sin emails ni notificaciones externas.
- Sin trabajador, un trabajo en cola muestra un aviso («no hay trabajador activo») en lugar de un spinner indefinido.

## 4. Seguridad

- Sesión y rol vigentes se vuelven a leer de la base al **crear, consultar, cancelar, reintentar y descargar**; el trabajador autoriza al solicitante al empezar, dentro de la lectura de preparación y de nuevo al publicar (actor desactivado mientras esperaba → no se genera nada, `CANCELLED` con motivo).
- Admin y Consulta conservan los permisos analíticos existentes: Consulta exporta el detalle que ya puede leer, no originales, administración privada ni borradores. **Un UUID no autoriza**: otra persona recibe «Exportación no encontrada» (sin revelar existencia). Administración **supervisa estados** en *Administración › Exportaciones* pero la descarga de archivos ajenos no está habilitada.
- Descarga: `GET /api/exportaciones/{id}/archivo/{fileId}`; la ruta sale solo del UUID guardado; `Cache-Control: private, no-store`, `Vary: Cookie`, `nosniff`, comprobación de tamaño contra el registro; nada en `public/`. Almacén privado **separado** de los originales (`CSAPP_EXPORT_DIR`, por defecto `almacen-exportaciones/`, ignorado por Git).
- Límites iniciales técnicos (configurables por entorno, no una política de conservación de fuentes): 2 exportaciones activas por persona, 6 en total, 20 000 000 de filas, 2 GB por archivo, 256 MB libres mínimos, bloque de 5 000 filas, vida útil 24 h.

## 5. Qué no hace

No sustituye el CSV pequeño existente (resúmenes de las cuatro vistas, que siguen utilizables mientras se genera un archivo grande). No exporta tablas internas indiscriminadamente. No hay archivos comprimidos (no aportan valor frente a la partición y no se ensamblan en memoria). Windows y lector de pantalla **sin probar**.
