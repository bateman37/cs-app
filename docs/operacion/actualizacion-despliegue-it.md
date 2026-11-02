# Actualización, vuelta atrás y despliegue para IT

Guía **ensayada** (Linux, base con datos de 09; ver la [validación](../validacion/csapp-10.md#actualización-09--10-y-vuelta-atrás)) para actualizar **09 → 10** sin perder datos y para volver a la versión anterior. **No se ha desplegado nada en producción y este repositorio no aprovisiona infraestructura**: lo que sigue es preparación; el despliegue queda pendiente de los datos de IT que se piden al final.

## 1. Qué identifica un candidato

- **SHA** del commit (en `build-info.json`, en Administración › Operación y en `ops salud`), `package-lock.json` (instalar con `npm ci`), las **nueve migraciones** de `prisma/migrations` y los comandos de este documento. No exige fusionar nada antes de ensayarlo.
- Migración nueva de CSAPP-10: `20261105090000_operacion_latido_instalacion` (tablas `WorkerInstance` e `InstallationMeta`; **solo añade**, no modifica ninguna tabla ni columna anterior, las ocho migraciones previas ni las `ConfigRevision`/payloads inmutables).

## 2. Actualizar 09 → 10

Ventana con indisponibilidad (parada coordinada; sin ejecutar nada en caliente):

1. **Respaldo verificado** antes de tocar nada (ver [copia y restauración](copia-restauracion.md)): parar la instancia, `npm run backup:crear` y `npm run backup:verificar`. Anotar SHA/versión actual (`npm run ops -- salud`), esquema y el SHA candidato.
2. **Parada coordinada**: `npm run stop:todo` (espera a la frontera segura del trabajo en curso; nada se marca completado por una señal de parada).
3. **Código nuevo** en una carpeta de release **nueva** (o `git checkout <SHA>`): `npm ci` y `npm run build:todo`. Los datos persistentes (`CSAPP_UPLOAD_DIR`, `CSAPP_EXPORT_DIR`) están **fuera** de la carpeta de la aplicación y no se copian ni se borran.
4. **Comprobar**: `npm run ops -- verificar` (el `.env` se reutiliza; apunta a las mismas rutas persistentes). La salud mostrará «migraciones pendientes» hasta el paso siguiente: es lo esperado.
5. **Migrar de forma explícita**: `npm run db:migrar` (aplica solo la migración nueva; sin reset). Después `npm run ops -- preparar` (enlaza los almacenes existentes con la identidad de la instalación; un almacén con datos sin marca **no** se adopta solo: `npm run ops -- adoptar-almacenes`).
6. **Arrancar y comprobar**: `npm run start:todo`; `npm run ops -- salud --web` correcto, entrar y revisar Administración › Operación y una vista.

Resultado ensayado: tras migrar, la **huella de cada tabla anterior es idéntica** a la previa (`npm run huella`), 10 arranca sobre los datos de 09 y las cuatro vistas responden.

## 3. Vuelta atrás

Son dos cosas distintas y **Prisma no garantiza un downgrade automático del esquema**.

### 3.1 Reversión de código (sin tocar datos) — válida mientras el esquema siga siendo compatible

La migración de CSAPP-10 solo añade tablas, así que el código de 09 funciona sobre el esquema de 10 (ensayado: 09 compilado arranca, la cuenta entra, las cuatro vistas responden y los datos no cambian). Procedimiento: `npm run stop:todo`; volver a la carpeta de release anterior (o `git checkout <SHA-09>` + `npm ci` + `npm run build`); `npm start` y `npm run worker`. **No** ejecutar `migrate reset`, `db push` ni borrar tablas. Las filas de `WorkerInstance` y `InstallationMeta` quedan inertes. Desde 10 en adelante, cualquier migración futura que **no** sea puramente aditiva exigirá la vía 3.2.

### 3.2 Restauración de datos (si el esquema o los datos no son compatibles, o se detectó corrupción)

Restaurar **la copia previa** en una base y almacenes nuevos y vacíos (ver [copia y restauración](copia-restauracion.md)), verificar, y conmutar la configuración (`DATABASE_URL`, `CSAPP_UPLOAD_DIR`, `CSAPP_EXPORT_DIR`) a lo restaurado. **Pérdida potencial**: todo lo escrito (cargas, correcciones, Health, configuraciones, exportaciones) **entre la copia y la conmutación** se pierde en la restauración; conserve la base y los almacenes actuales como evidencia hasta decidir. Nunca restaurar encima de la base operativa.

## 4. Requisitos de destino para IT (sin inventar el destino)

| Tema | Requisito |
| --- | --- |
| Procesos persistentes | Un proceso Node web (`next start`) y un trabajador persistente (`worker-dist/worker.mjs`) que **comparten el mismo `.env`**, la misma base y los mismos almacenes. Puede usarse `npm run start:todo` como un único proceso supervisado. |
| Supervisor y reinicio | Reinicio automático ante salida ≠ 0; parada con tiempo suficiente para el cierre ordenado (≥ `CSAPP_WORKER_STOP_TIMEOUT_MS` + 15 s, 135 s por defecto). Ejemplo NSSM en [instalación y operación](instalacion-operacion.md#7-operación-manual-y-supervisión-por-it). |
| Usuario de servicio y permisos | Cuenta sin privilegios de administrador local; **lectura** de la aplicación; **lectura y escritura** solo en `CSAPP_UPLOAD_DIR`, `CSAPP_EXPORT_DIR` y `CSAPP_STATE_DIR`; en PostgreSQL, un rol propietario de su base (`cs_app…`) con `CREATE` en `public` (migraciones) y sin privilegios sobre otras bases. |
| Volúmenes | Dos directorios **privados distintos y persistentes**, compartidos por web y trabajador, fuera de la carpeta de release, de `public/` y de `.next/`; con espacio para originales (≤ 200 MB por archivo) y exportaciones (≈ 230 MB por millón de hechos). Copias restringidas (contienen datos privados). |
| Secretos | `BETTER_AUTH_SECRET` y `DATABASE_URL` en el `.env` del servicio o en el gestor de secretos de IT; copia por canal separado (ver copia). No en Git ni en copias sin cifrar. |
| URL y TLS | `BETTER_AUTH_URL` = origen público `https://…`; TLS terminado en el proxy; cookies seguras; origen de confianza único. |
| Proxy | Reenviar `/` al web; **sin buferizar** subidas (`/api/cargas`, hasta `CSAPP_UPLOAD_MAX_BYTES` = 200 MB) ni descargas (`/api/exportaciones`, de hasta ≈ 230 MB por parte y 2 GB por archivo), con tiempos de lectura/escritura que toleren cargas lentas (≥ 10 min recomendado) y sin límite de cuerpo inferior al de la aplicación. **Ese salto (proxy real) no se ha probado**: solo se probó la ruta directa navegador → `next start`. |
| Salud | `GET /api/salud` (pública, mínima) para el balanceador; `ops salud --json` y Administración › Operación para el detalle. |
| Registros | Salida estándar de web y trabajador a archivo con rotación; formato `fecha nivel instancia mensaje`. |
| Copias | Frecuencia, custodia, acceso y retención: **decisión de IT** (opciones en [copia y restauración](copia-restauracion.md)); no hay RPO/RTO contratados. |

## 5. Datos que IT debe aportar (despliegue pendiente)

Destino (servidor y sistema), dominio y certificado, mecanismo de supervisión, usuario de servicio, rutas de los volúmenes privados, ubicación de PostgreSQL y su versión, política de copias, y autorización explícita de despliegue. Sin ellos, el estado es **preparación completa, despliegue pendiente**.
