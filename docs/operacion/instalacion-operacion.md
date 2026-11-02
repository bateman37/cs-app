# Instalación y operación (vigente desde CSAPP-10)

Guía única y vigente para instalar, arrancar, vigilar y parar CS App en **Windows con PowerShell, Node y PostgreSQL** (la aplicación web sigue siendo la misma: ni Electron, ni Docker, ni WSL, ni proveedor cloud). Sustituye a las guías PowerShell por entrega, que quedan como [históricas](../plan/guia-documental.md#guías-por-entrega-históricas). El estado real de lo probado está en la [validación de CSAPP-10](../validacion/csapp-10.md): **el recorrido está ensayado en Linux; el ensayo en Windows está pendiente** (ver [registro de aceptación](../validacion/registro-aceptacion.md), caso `INS-01`).

## 1. Requisitos y versiones

| Componente | Ensayado | Permitido por `engines` / notas |
| --- | --- | --- |
| Node.js | 22.22 | `>=22.18.0 <23` o `>=24.11.0` (24 no ensayado) |
| PostgreSQL | 16.15 | Herramientas cliente 16 (`pg_dump`, `pg_restore`, `psql`) en el `PATH` para las copias |
| npm | 10.9.4 (`packageManager`) | Instalar siempre con el lockfile (`npm ci`) |
| Sistema | Linux (ensayado) | Windows 10/11 o Server con PowerShell: **sin ensayar** |

No se actualizan dependencias por conveniencia. La advertencia de `pg` («Calling client.query() when the client is already executing a query…») es de la dependencia; ver el límite en la [validación](../validacion/csapp-10.md#advertencia-de-pg).

## 2. Instalación desde un checkout limpio (SHA que incluye 01–10)

```powershell
git clone https://github.com/bateman37/cs-app.git C:\apps\cs-app
cd C:\apps\cs-app
git checkout <SHA-DEL-CANDIDATO>           # el SHA exacto que Dennis/IT hayan acordado
copy .env.example .env                      # completar con valores propios (ver el catálogo); .env no se versiona
```

1. **Preparar datos persistentes fuera de la carpeta de la aplicación** (una actualización no debe borrarlos): por ejemplo `C:\datos\cs-app\originales`, `C:\datos\cs-app\exportaciones` y `C:\datos\cs-app\estado`. En `.env`: `CSAPP_UPLOAD_DIR`, `CSAPP_EXPORT_DIR` (**obligatorias y absolutas en operación**, distintas) y, opcionalmente, `CSAPP_STATE_DIR`. El resto: [catálogo de variables](variables-entorno.md). Genere el secreto al azar (≥ 32 caracteres):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Instalar con el lockfile y compilar web y trabajador** (una sola vez por versión):

   ```powershell
   npm ci
   npm run build:todo
   ```
3. **Comprobar antes de tocar la base** (versiones, conectividad y permisos PostgreSQL, secreto, origen, rutas, espacio, puerto, herramientas de copia). No imprime credenciales:

   ```powershell
   npm run ops -- verificar --puerto
   ```
4. **Migrar de forma incremental** (nunca `migrate reset`, `db push`, semillas ni `migrate dev` en una instalación operativa) y **preparar** los almacenes (enlaza la instalación con ellos; es idempotente):

   ```powershell
   npm run db:migrar
   npm run ops -- preparar
   ```
5. **Primer Administrador** con entrada segura (la contraseña se pide sin eco, o se toma de `CSAPP_CUENTA_CLAVE` solo en esa sesión; no hay cuenta por defecto ni registro público; repetirlo no sobrescribe nada):

   ```powershell
   npm run cuenta:crear -- --correo admin@vincle.example --nombre "Nombre Apellido" --rol admin
   ```
6. **Arrancar** (web + trabajador, con cierre coordinado) y comprobar:

   ```powershell
   npm run start:todo          # primer plano; Ctrl+C o `npm run stop:todo` desde otra consola
   npm run ops -- salud --web  # otra consola
   ```

   Equivalente manual, sin supervisor: `npm start` (web) y `npm run worker:start` (trabajador) en dos consolas. Ambos usan el **mismo `.env`**, la misma base y los mismos almacenes. No se recompila en cada reinicio.

El primer acceso verá estados vacíos honestos (sin cifras ni colores inventados). La puesta en marcha de datos está en la [guía de Dennis](../plan/guia-dennis.md).

## 3. Procesos: qué hace cada orden

| Orden | Efecto |
| --- | --- |
| `npm run ops -- verificar [--puerto]` | Comprobación previa; código 1 si hay errores. |
| `npm run ops -- preparar` | Registra el identificador de instalación y enlaza los dos almacenes (marca `.csapp-store.json`). Un almacén de **otra** instalación o con datos sin marca se **rechaza**; adoptarlo es explícito (`adoptar-almacenes`). |
| `npm run start:todo` | Supervisor en primer plano: comprueba, rechaza un segundo arranque (instancia viva, puerto ocupado o trabajador vivo en la base), lanza `next start` y `worker-dist/worker.mjs`, registra **sus** procesos en `CSAPP_STATE_DIR` y los cierra juntos. Si un hijo muere, cierra el otro y sale con código 1 (para que el supervisor de IT lo reinicie). |
| `npm run stop:todo` | Cierre ordenado de lo que ese supervisor registró: pide el cierre al trabajador por la base (multiplataforma) y espera su frontera segura (máx. `CSAPP_WORKER_STOP_TIMEOUT_MS`); con `--forzar` termina **solo** los PID registrados. Nunca mata por nombre. |
| `npm run ops -- estado` | Procesos registrados y vigencia. |
| `npm run ops -- salud [--json] [--web]` | Comprobación técnica; código 0 correcto, 1 degradado, 2 base caída. |
| `npm run ops -- diagnostico <archivo>` | Diagnóstico redactado (sin secretos, DSN, sesiones, SQL ni datos de clientes). |

Un **trabajador suelto** (`npm run worker:start`) también registra su instancia y late, y se cierra con Ctrl+C/SIGTERM. En Windows el cierre por señal de otro proceso no es graceful: use `npm run stop:todo`, que lo pide por la base.

## 4. Salud y estados

Administración › **Operación** (solo Administrador) y `npm run ops -- salud` muestran: versión/SHA, esquema (migraciones aplicadas frente a las del código), base, trabajador, colas, trabajos atascados y almacenes. `GET /api/salud` (pública) devuelve **solo** `{"status":"ok|degradado|caido"}`; el detalle exige sesión de Administrador (`/api/administracion/salud`; `?descargar=1` entrega el diagnóstico redactado).

| Situación | Cómo se ve | Qué hacer |
| --- | --- | --- |
| Web responde, base caída | `caido`; «BASE_NO_DISPONIBLE» | Arrancar/recuperar PostgreSQL. La web y el trabajador reintentan; el latido se reanuda solo. |
| Trabajador **ausente** | «TRABAJADOR_AUSENTE»; colas sin avanzar | `npm run worker:start`. Con base vacía de trabajos, un trabajador vivo aparece **«presente en reposo»**: no se infiere caído por no tener trabajos. |
| Trabajador **presente sin avance** | «TRABAJADOR_SIN_AVANCE» | Un trabajo lleva más de `CSAPP_HEALTH_STALL_MS` sin confirmar un bloque. Mire el registro; pare con `stop:todo` (el trabajo vuelve a la cola en una frontera segura o su lease caduca). |
| Trabajador **detenido** | «detenido» | Parada ordenada reciente (distinto de ausente). |
| Almacén sin acceso/espacio/ajeno | «ALMACEN_*» | Comprobar la ruta, permisos y espacio; un almacén de otra instalación se rechaza. |
| Esquema pendiente | «ESQUEMA_PENDIENTE» | `npm run db:migrar`. |

Umbrales técnicos (no SLA): latido 15 s, vivo si < 45 s, sin avance 15 min, cola desatendida 5 min; configurables en el [catálogo](variables-entorno.md). Se probaron con reloj controlado, sin ampliarlos para ocultar fallos.

## 5. Registros

Línea por evento: `2026-11-02T10:00:00.000Z INFO trabajador-1234-ab12cd34 Trabajo PREPARE del lote … terminado`. Fecha UTC, nivel (INFO/WARN/ERROR), instancia y, en los eventos de trabajo, el lote o la exportación. No se vuelcan filas privadas. Con el supervisor, el web y el trabajador comparten su salida estándar; para IT, redirija a un archivo con rotación.

## 6. Incidencias frecuentes

- **Puerto ocupado / segundo arranque**: `start:todo` se niega a crear otra instancia (no usa otro almacén por accidente). Pare la anterior (`stop:todo`) o cambie `CSAPP_PORT`.
- **«Arranque rechazado (OPCION_DE_PRUEBA)»**: hay `CSAPP_ENABLE_SYNTHETIC_PROFILES`, `CSAPP_APPROVED_TEST_DB` o `CSAPP_COUNT_QUERIES` en el entorno; retírelas.
- **«ALMACEN_MARCA_AJENA»**: `CSAPP_UPLOAD_DIR`/`CSAPP_EXPORT_DIR` apuntan al almacén de otra instalación (o intercambiados). Corrija la ruta.
- **«ALMACEN_CON_DATOS_SIN_MARCA»**: carpeta con archivos sin identidad (p. ej. restaurada a mano): si es la correcta, `npm run ops -- adoptar-almacenes`.
- **Cierre con código 3 del trabajador**: el trabajo en curso no terminó en el plazo; **no se marcó nada como completado**; su lease caduca y se reanuda sin duplicar.

## 7. Operación manual y supervisión por IT

Con los procesos compilados, IT puede supervisar `npm run start:todo` (un solo proceso, con reinicio ante salida ≠ 0) o dos procesos independientes (`node node_modules\next\dist\bin\next start -p 3000` y `node worker-dist\worker.mjs`, con `CSAPP_HOME` y el `.env` de la instalación). Ejemplo **orientativo** para NSSM (no se instala ni programa nada en equipos reales desde este repositorio):

```powershell
nssm install CSApp "C:\Program Files\nodejs\node.exe" "node_modules\tsx\dist\cli.mjs scripts\ops.ts iniciar"
nssm set CSApp AppDirectory C:\apps\cs-app
nssm set CSApp AppExit Default Restart
nssm set CSApp AppStopMethodConsole 150000
```

Detalle de requisitos de destino, proxy, TLS, usuario de servicio y actualización: [actualización y despliegue para IT](actualizacion-despliegue-it.md). Copias y restauración: [copia y restauración](copia-restauracion.md).
