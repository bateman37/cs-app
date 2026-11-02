# Operación, salud y cierre técnico (CSAPP-10)

Decisiones técnicas de la última entrega. Los procedimientos están en [instalación y operación](../operacion/instalacion-operacion.md); aquí, el porqué y los contratos internos.

## Latido por trabajador (`WorkerInstance`)

- Cada proceso trabajador registra una **instancia** (`id`, `pid`, `host`, versión, SHA) y la refresca cada `CSAPP_WORKER_HEARTBEAT_MS` **estando en reposo o procesando** (`src/server/ops/worker-instance.ts`). Un solo latido por proceso, aunque ejecute dos bucles (cargas y exportaciones).
- El **avance** del trabajo en curso se anota en memoria cuando se confirma un bloque (`assertFence`/`assertExportFence` y cada página de exportación) y se publica en el siguiente latido (`progressAt`). El avance publicado es el **más antiguo** de las ranuras activas, de modo que un bucle atascado no queda oculto por otro que sí avanza.
- La salud clasifica: `ausente` (ninguna instancia con latido < 3 × latido), `presente_en_reposo`, `presente_procesando`, `presente_sin_avance` (vivo, ocupado y con `progressAt` más antiguo que `CSAPP_HEALTH_STALL_MS`) y `detenido` (cierre ordenado reciente). **La ausencia de trabajos nunca prueba que el trabajador esté caído.** La supervisión de exportaciones considera viva a una instancia o, por compatibilidad, un latido reciente de trabajo.
- Un fallo de la base **no detiene** el latido: se avisa una vez, se reintenta en el siguiente ciclo y se registra la recuperación.
- **Petición de cierre multiplataforma**: `WorkerInstance.stopRequestedAt`. `ops parar` la escribe y el trabajador la lee en su latido; no depende de señales POSIX (en Windows `SIGTERM` entre procesos termina de golpe). El cierre espera la frontera segura (el trabajo vuelve a la cola con su checkpoint o termina) hasta `CSAPP_WORKER_STOP_TIMEOUT_MS`; si se agota, el proceso sale con **código 3 sin marcar nada como completado** y el lease caduca (otro trabajador reanuda con fencing, sin duplicar).

## Identidad de instalación y almacenes

- `InstallationMeta('installation_id')` se crea una vez (idempotente, `INSERT … ON CONFLICT DO NOTHING`). Cada almacén lleva `.csapp-store.json` con ese identificador y su clase (`uploads`/`exports`).
- Web y trabajador, en modo operativo, **rechazan** un almacén de otra instalación, intercambiado o con datos y sin marca (en vez de crear otro en silencio). Adoptar es una acción explícita (`ops adoptar-almacenes`). Una restauración deliberada usa `--nuevo-origen` para generar una identidad nueva.
- Reglas de ubicación (`checkStoreLayout`, pura y probada): en operación, rutas absolutas y explícitas, distintas y no anidadas, fuera de `public/`, `.next/`, `worker-dist/` y de la carpeta de la aplicación. La raíz de la aplicación (`appRoot()`) sale de `CSAPP_HOME`, de `worker-dist/..` o del directorio de trabajo, en ese orden: **web y trabajador usan la misma configuración efectiva aunque cambie el directorio de trabajo**.
- `src/instrumentation.ts` ejecuta la comprobación de arranque en la web compilada (`assertStartup`): los fallos de configuración son fatales; una base caída en el arranque no lo es.

## Modo operativo

`NODE_ENV=production` sin `CSAPP_APPROVED_TEST_DB` (destino de pruebas aprobado por el guard central). En él `CSAPP_ENABLE_SYNTHETIC_PROFILES`, `CSAPP_APPROVED_TEST_DB` y `CSAPP_COUNT_QUERIES` **impiden el arranque**; `TEST_DATABASE_URL` y `SHADOW_DATABASE_URL` avisan y `ops iniciar` las vacía en los procesos hijo (un valor definido, aunque vacío, impide que `next start` las cargue desde `.env`).

## Supervisor (`scripts/ops.ts iniciar`)

Proceso Node en primer plano, sin shell. Rechaza un segundo arranque (registro vigente con latido propio, puerto ocupado o trabajador vivo en la base) para no crear una instancia con otro almacén. Registra **sus** PID en `CSAPP_STATE_DIR/cs-app.run.json` (con latido: protege frente a PID reutilizados). `parar` actúa solo sobre lo registrado, nunca por nombre; `--forzar` termina únicamente esos PID. Si un hijo muere, cierra el otro y sale con 1.

## Salud

`collectHealth` (reloj inyectable) lee base, esquema (migraciones aplicadas frente a `build-info.json`, o `prisma/migrations` si falta), trabajadores, colas, leases vencidos y almacenes (sonda real de escritura y espacio). Funciona con migraciones pendientes (informa del esquema en lugar de fallar). Salida pública: solo `{status}` (fuera del proxy de sesión, `api/salud`); detalle y diagnóstico redactado solo Administrador.

## Puente de conciliación (nivel 4)

`REC-N4-01…06` ([contrato](../validacion/conciliacion-contrato.md)) se calculan en la **misma lectura** `REPEATABLE READ` que los niveles 1–3, llamando a los mismos servicios que las pantallas (`economicsInTx`, `computePulse`, `hourFacts`/`ticketFacts`/`papFacts`) con el mismo periodo, servicio y ámbito. Solo compara perímetros y unidades comunes; el periodo del informe debe coincidir con uno de los cinco de las pantallas (si no, `NO_DISPONIBLE` con la explicación). Calidad se contrasta con sus indicadores, nunca con horas de otro perfil o filtro.
