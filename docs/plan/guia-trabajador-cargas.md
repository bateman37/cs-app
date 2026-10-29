# Guía del trabajador de cargas: operación y recuperación (CSAPP-02)

Contrato del motor: [motor de cargas](../arquitectura/motor-cargas-contrato.md). **Los comandos de PowerShell están escritos y no se han ejecutado en Windows**; lo probado es Linux (ver [validación](../validacion/csapp-02.md)).

## Qué debe estar en marcha

Dos procesos del mismo proyecto, con el **mismo `.env`** y el **mismo `CSAPP_UPLOAD_DIR`**:

1. **Web**: `npm run build` y `npm start` (Next.js).
2. **Trabajador**: `npm run worker` (construye `worker-dist/worker.mjs` con esbuild y lo arranca). Para reanudar sin reconstruir: `npm run worker:start`. No necesita `next dev` ni el servidor web.

Sin trabajador, las cargas se reciben y quedan «En cola»; no se pierden: se procesan al arrancarlo. Se pueden ejecutar varios trabajadores: la cola los coordina (reclamación exclusiva) y dos trabajadores nunca activan dos veces un lote.

## PowerShell

```powershell
# 1. Directorio privado persistente (fuera de public y de Git), compartido por web y trabajador.
#    Añádalo al archivo .env (CSAPP_UPLOAD_DIR="C:\datos\cs-app\almacen-cargas") y créelo:
New-Item -ItemType Directory -Force -Path "C:\datos\cs-app\almacen-cargas" | Out-Null

# 2. Aplicar migraciones sin borrar nada
npm run db:migrar

# 3. Terminal 1: web
npm run build
npm start

# 4. Terminal 2: trabajador
npm run worker
```

Detener: `Ctrl+C` en cada terminal. El trabajador termina el bloque en curso, devuelve el trabajo a la cola conservando su checkpoint y sale con código 0. Reanudar: `npm run worker:start` (o `npm run worker` si cambió el código).

## Recuperación

| Situación | Qué ocurre | Qué hacer |
| --- | --- | --- |
| Se detiene el trabajador (Ctrl+C) | El trabajo vuelve a «pendiente» sin gastar intento | Arrancarlo de nuevo: retoma desde el checkpoint |
| El trabajador muere (kill, corte de luz) | El trabajo sigue «en ejecución» hasta vencer el lease (60 s); otro trabajador (o el reiniciado) lo reclama y retoma | Arrancarlo de nuevo; no hay duplicados (clave única de posición) |
| Se reinicia la web | El estado y el progreso están en PostgreSQL | Nada |
| Un trabajo falla | Se reintenta con espera creciente hasta 3 intentos y después el lote queda «Con error» con el motivo | Corregir la causa y usar «Reprocesar» (reutiliza el archivo original) |
| Falla la activación | La transacción se deshace entera; los datos activos anteriores no cambian | Igual que arriba |
| Cambiaron reglas o maestros tras la previsualización | La activación no aplica nada: el lote vuelve a «En cola» y se revalida | Revisar la nueva previsualización y confirmar |
| Subida interrumpida | No se procesa; el lote queda «Recibiendo» y a los 60 min pasa a «Rechazado» y se borra el parcial | Subir de nuevo |

Parámetros (opcionales, ver `.env.example`): `CSAPP_WORKER_LEASE_MS`, `CSAPP_WORKER_HEARTBEAT_MS`, `CSAPP_WORKER_POLL_MS`, `CSAPP_WORKER_MAX_ATTEMPTS`, `CSAPP_WORKER_CHUNK_ROWS`.

## Pruebas aisladas del motor

Solo contra una base de test explícita (nombre acabado en `_test` y distinta de `DATABASE_URL`):

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npx vitest run tests/cargas.test.ts tests/cargas-api.test.ts tests/cargas-trabajador.test.ts
# Volumen (1 000 000 filas, tarda varios minutos):
npx vitest run tests/cargas-volumen.test.ts
```

Los perfiles sintéticos se habilitan solo dentro de esas pruebas (variable de servidor `CSAPP_ENABLE_SYNTHETIC_PROFILES` igual al nombre de la base de test, nombre `_test` y esquema `csapp_synthetic` creado por el arranque de pruebas). **No** definir esa variable en la base de trabajo.

## Ficheros y limpieza

Los archivos subidos viven en `CSAPP_UPLOAD_DIR\files\<uuid>`; los parciales, en `incoming\`. No se borra automáticamente ningún archivo de lotes (activos, completados, rechazados o cancelados): no hay política de retención aprobada. Incluya el directorio en las copias de seguridad junto con la base de datos.
