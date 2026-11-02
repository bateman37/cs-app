# Catálogo de variables de entorno

Propietario único de las variables de CS App (CSAPP-10). [`.env.example`](../../.env.example) es el modelo copiable; este catálogo explica unidades, valor técnico inicial y efecto. Una prueba ([`tests/csapp10-entorno.test.ts`](../../tests/csapp10-entorno.test.ts)) falla si el código lee una variable `CSAPP_*` que no figura aquí y en `.env.example`. Nunca se versionan `.env`, secretos, respaldos ni fuentes. Los valores iniciales son **técnicos** (acotan memoria, disco y concurrencia), no políticas de negocio.

## Obligatorias

| Variable | Efecto |
| --- | --- |
| `DATABASE_URL` | Base PostgreSQL exclusiva (`cs_app`, `cs_app_prod`…). Nombre `cs_app…`; la usan web, trabajador, migraciones y herramientas. |
| `BETTER_AUTH_SECRET` | Secreto de sesión, ≥ 32 caracteres al azar. **Se custodia por un canal seguro aparte** (ver [copia](copia-restauracion.md)); cambiarlo invalida todas las sesiones. |
| `BETTER_AUTH_URL` | Origen público (esquema + host + puerto, sin ruta). Es el origen de confianza de cookies y formularios. Con TLS terminado en un proxy debe ser el `https://…` público. |
| `CSAPP_UPLOAD_DIR` · `CSAPP_EXPORT_DIR` | **Obligatorias en instalaciones operativas** (`NODE_ENV=production`): rutas **absolutas**, directorios privados **distintos**, no anidados, fuera de `public/`, `.next/`, `worker-dist/` y de la carpeta de la aplicación (una actualización no debe borrarlos). En desarrollo, por defecto `./almacen-cargas` y `./almacen-exportaciones`. |

## Procesos y operación (CSAPP-10)

| Variable | Valor inicial | Efecto |
| --- | --- | --- |
| `CSAPP_PORT` (o `PORT`) | puerto de `BETTER_AUTH_URL`, si no 3000 | Puerto de `next start` lanzado por `npm run start:todo`. |
| `CSAPP_HOST` | `127.0.0.1` | Dirección de escucha del web. Detrás de un proxy, mantener local. |
| `CSAPP_HOME` | carpeta de la aplicación | Raíz de la aplicación para web, trabajador y herramientas, **independiente del directorio de trabajo** (el trabajador la deduce de `worker-dist/..`). |
| `CSAPP_STATE_DIR` | `<aplicación>/estado-runtime` | Registro de ejecución y bloqueos del supervisor (PID, latido). Transitorio; sin datos. |
| `CSAPP_WORKER_ID` | `trabajador-<pid>-<azar>` | Identificador de la instancia del trabajador en el latido y en los registros. |
| `CSAPP_WORKER_STOP_TIMEOUT_MS` | 120000 | Tiempo máximo del cierre ordenado del trabajador. Si se agota sale con código 3 **sin marcar nada como completado** (el lease caduca y otro trabajador reanuda). |
| `CSAPP_HEALTH_WORKER_ALIVE_MS` | 3 × latido (45000) | Un trabajador está vivo si su último latido es más reciente. |
| `CSAPP_HEALTH_STALL_MS` | 900000 (15 min) | «Presente pero sin avanzar»: trabajo en curso sin confirmar ningún bloque en este tiempo. |
| `CSAPP_HEALTH_QUEUE_AGE_MS` | 300000 (5 min) | Cola desatendida: trabajos en cola más antiguos que esto sin trabajador vivo. |
| `CSAPP_HEALTH_INSTANCE_HISTORY_MS` | 86400000 (24 h) | Cuánto tiempo se muestran instancias detenidas o sin latido. |
| `CSAPP_OPERATIVA` | — | `1` fuerza en `ops verificar` las reglas de instalación operativa aunque `NODE_ENV` no sea `production`. |
| `CSAPP_BUILD_SHA` | `git rev-parse HEAD` | SHA que `build-info.json` graba al compilar (útil si se compila sin `.git`). |
| `CSAPP_CUENTA_CLAVE` | — | **Solo la sesión actual**: contraseña para `npm run cuenta:crear` sin interacción. Nunca en `.env`, argumentos ni registros. |

## Motor de cargas (CSAPP-02)

| Variable | Valor inicial | Efecto |
| --- | --- | --- |
| `CSAPP_UPLOAD_MAX_BYTES` | 209715200 (200 MB) | Tamaño máximo de un archivo subido. |
| `CSAPP_UPLOAD_MAX_UNCOMPRESSED_BYTES` | 1073741824 (1 GB) | Tamaño máximo descomprimido de un XLSX. |
| `CSAPP_UPLOAD_MAX_RATIO` | 200 | Razón máxima de compresión (defensa frente a archivos bomba). |
| `CSAPP_UPLOAD_MAX_ROWS` | 5000000 | Filas máximas por archivo. |
| `CSAPP_UPLOAD_MAX_SHARED_STRINGS_BYTES` | 268435456 (256 MB) | Tabla de cadenas compartidas máxima de un XLSX. |
| `CSAPP_UPLOAD_MAX_CONCURRENT` | 3 | Subidas simultáneas. |
| `CSAPP_UPLOAD_MAX_OPEN_BATCHES` | 20 | Lotes abiertos (sin completar) permitidos. |
| `CSAPP_UPLOAD_INCOMPLETE_MINUTES` | 60 | Una recepción sin terminar pasa a rechazada y su parcial se borra. |
| `CSAPP_WORKER_LEASE_MS` | 60000 | Vigencia del arrendamiento de un trabajo. |
| `CSAPP_WORKER_HEARTBEAT_MS` | 15000 | Periodo del latido del trabajador y de sus trabajos. |
| `CSAPP_WORKER_POLL_MS` | 2000 | Sondeo de la cola. |
| `CSAPP_WORKER_MAX_ATTEMPTS` | 3 | Intentos por trabajo antes de fallar. |
| `CSAPP_WORKER_BACKOFF_MS` | 2000 | Espera base del reintento (exponencial, máx. 60 s). |
| `CSAPP_WORKER_CHUNK_ROWS` | 1000 | Filas por bloque de preparación. |
| `CSAPP_WORKER_ACTIVATION_TIMEOUT_MS` | 1800000 | Tiempo máximo de una activación. |

## Exportaciones (CSAPP-09)

| Variable | Valor inicial | Efecto |
| --- | --- | --- |
| `CSAPP_EXPORT_TTL_HOURS` | 24 | Vida útil de un archivo terminado; caducar limpia solo artefactos y materialización. |
| `CSAPP_EXPORT_MAX_ACTIVE_PER_USER` · `CSAPP_EXPORT_MAX_ACTIVE_TOTAL` | 2 · 6 | Exportaciones activas por persona y en total. |
| `CSAPP_EXPORT_MAX_ROWS` | 20000000 | Filas máximas de una exportación. |
| `CSAPP_EXPORT_MAX_FILE_BYTES` | 2147483648 | Tamaño máximo de un archivo. |
| `CSAPP_EXPORT_PART_ROWS` | 1000000 | Filas por archivo (≤ 1 048 575, límite de una hoja de Excel). |
| `CSAPP_EXPORT_PAGE_ROWS` | 5000 | Bloque de lectura/escritura con contrapresión (memoria proporcional al bloque). |
| `CSAPP_EXPORT_MIN_FREE_BYTES` | 268435456 | Espacio libre mínimo antes de generar y umbral de la salud de almacenes. |
| `CSAPP_EXPORT_MATERIALIZE_TIMEOUT_MS` | 3600000 | Tiempo máximo de la lectura coherente de preparación. |

## Interpretaciones configurables de fuentes (CSAPP-04)

| Variable | Valor inicial | Efecto |
| --- | --- | --- |
| `CSAPP_BUG_TERMINAL_STATES` | ninguno | Estados de bugs que se tratan como terminales, separados por `;`. Sin configurar, ninguno (no se cierra por conjetura). |
| `CSAPP_ZENDESK_HOSTS` | — | Hosts reconocidos en URLs de tickets de Zendesk (coma). |
| `CSAPP_DEVOPS_PRODUCTS` | ninguno | Producto de una URL de DevOps: `VFS=ProyectoA,ProyectoB;VSW=ProyectoC`. |

## Solo desarrollo y pruebas — **no definirlas en producción**

| Variable | Efecto |
| --- | --- |
| `TEST_DATABASE_URL` | Base aislada `cs_app…_test` de las pruebas (guard central). Inerte en producción; no debe heredarse (el supervisor la vacía en los procesos hijo y `ops verificar` avisa). |
| `SHADOW_DATABASE_URL` | Solo `prisma migrate dev`. Mismo tratamiento. |
| `CSAPP_ENABLE_SYNTHETIC_PROFILES` · `CSAPP_APPROVED_TEST_DB` · `CSAPP_COUNT_QUERIES` | Opciones de prueba: **en una instalación operativa impiden el arranque** (error explícito); nunca se ignoran en silencio. |
| `E2E_PORT` · `E2E_CHROMIUM` · `E2E_SOLO` · `E2E_CAPTURAS` · `E2E_MEASURES_FILE` · `ENSAYO_PORT` · `TICKETS` · `TIMES` · `WRIKE` | Parámetros de los recorridos y ensayos (`npm run e2e*`, `ensayo:*`). |
