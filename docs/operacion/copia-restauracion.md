# Copia de seguridad y restauración (CSAPP-10 §7-8)

Guía operativa de las herramientas de **crear, verificar y restaurar** copias de CS App. Describe lo **implementado y ensayado** y separa con claridad lo que son **opciones para IT** (frecuencia, custodia, acceso, retención): esas decisiones no están tomadas, no hay tareas programadas ni se afirma ningún RPO/RTO contratado. Resultados medidos del ensayo: [validación](../validacion/csapp-10-restauracion.md). Arquitectura general de instalación y operación: documentación de CSAPP-10 (supervisor, salud, almacenes).

## 1. Herramientas

| Orden | Para qué | Código de salida |
| --- | --- | --- |
| `npm run backup:crear -- --destino <carpeta> [--esperar <s>] [--web-parada] [--aceptar-originales-ausentes] [--json]` | Crea una copia **con parada controlada** (sin copia en caliente) | 0 copia publicada y verificada · 1 fallo o condiciones no acreditadas · 2 uso incorrecto |
| `npm run backup:verificar -- <carpeta-de-la-copia> [--json]` | Verifica una copia sin base de datos y sin modificar nada | 0 todo OK · 1 algún FALLO |
| `npm run backup:restaurar -- <copia> --db-url <url> --uploads <carpeta> --exports <carpeta> [--nuevo-origen] [--normalizar-trabajos] [--permitir-esquema-anterior] [--informe <archivo.json>] [--json]` | Restaura en una base y carpetas **nuevas** | 0 restauración verificada · 1 fallo o rechazo |

Node puro (sin Bash ni PowerShell obligatorio), con las herramientas oficiales de PostgreSQL: `pg_dump -Fc` y `pg_restore`, lanzadas con `execFile` **sin shell ni interpolación** (las rutas con espacios o comillas viajan como argumentos). Código en `src/server/ops/backup/` y `scripts/backup.ts`.

- **Versiones.** `pg_dump` no puede ser más antiguo que el servidor (se rechaza antes de crear nada). `pg_restore` debe ser igual o posterior al `pg_dump` que creó la copia, y el servidor destino igual o posterior al de la copia. Si las herramientas no están en el `PATH`, `CSAPP_PG_BIN` apunta a su carpeta (también `CSAPP_PG_DUMP`, `CSAPP_PG_RESTORE`).
- **Credenciales.** La contraseña viaja solo por `PGPASSWORD` en el **entorno del proceso hijo** (junto con `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`); nunca en `argv`, en registros, en errores ni en la copia. Toda salida se redacta (URL con credenciales, `PGPASSWORD`, valores conocidos). Para la restauración se recomienda dar la URL por la variable `CSAPP_RESTORE_DATABASE_URL` en lugar de `--db-url`, para que no quede en el historial de la consola.
- **Qué NO hace nunca:** `--clean`, `DROP DATABASE`, `TRUNCATE`, reinicios para «hacer sitio», borrado automático de copias o de fuentes, arrancar trabajadores o reutilizar conexiones al origen. Solo puede crear (`CREATE DATABASE`) la base destino si su nombre supera el guard.

## 2. Crear una copia: secuencia de parada controlada

La vía inicial es una **copia con parada controlada**: la aplicación está **no disponible** mientras dura (web y trabajador parados). No se ofrece copia en caliente.

1. **Detener** la instalación de forma ordenada: `npm run stop:todo` (cierra supervisor, web y trabajador; el trabajador termina o devuelve el trabajo a la cola en una frontera segura y se registra `STOPPED`). Si se hace sin supervisor, detener la web y el trabajador por su procedimiento ordenado.
2. **Crear la copia:** `npm run backup:crear -- --destino "<carpeta>"`. Con `--esperar 300` la herramienta sondea hasta 300 s a que se cumpla la parada y, si no, sale con error claro **sin forzar nunca un estado**.
3. **Verificar** (la herramienta ya verifica el temporal antes de publicar; `backup:verificar` permite repetirlo en otro momento o equipo).
4. **Volver a arrancar:** `npm run start:todo`. Mientras hay copia en curso, `ops iniciar` se niega a arrancar (consulta `backupLockLive()`), así que no se puede arrancar «a medias» durante la copia.

La herramienta **no anuncia una copia coherente** si no acredita todas estas condiciones (comprobación al empezar y de nuevo antes de publicar):

| Condición | Cómo se comprueba |
| --- | --- |
| Ningún supervisor vigente | archivo de ejecución del supervisor con PID vivo y latido reciente |
| Ningún trabajador vivo | `WorkerInstance` ≠ `STOPPED` con latido más reciente que el umbral de salud (`workerAliveMs`) |
| Ningún trabajo en curso | `UploadJob` `RUNNING` y `ExportJob` `PREPARING`/`GENERATING` con lease vigente |
| Ninguna subida recibiéndose | `UploadBatch` `RECEIVING` reciente (menos de `CSAPP_UPLOAD_INCOMPLETE_MINUTES`) |
| La web no responde | `BETTER_AUTH_URL/api/salud` falla; o `--web-parada` (explícito, **con aviso**: no se ha comprobado) |
| Ninguna otra copia | bloqueo `backup.lock` en el directorio de estado, con PID y latido (vigencia por latido) |

Las colas **pendientes** (`QUEUED`/`PENDING`) no impiden la copia: se conservan en la base y las retomará el trabajador cuando se arranque.

**Indisponibilidad.** Toda la duración de la copia (parada + copia + verificación + arranque). Para el volumen del ensayo, las duraciones medidas están en la validación; dependen del tamaño de la base, de los almacenes y del disco, y **no son una promesa para producción**. Planifique la ventana con una copia de prueba en su propio equipo.

## 3. Coherencia entre base de datos y archivos

Antes de escribir nada, la herramienta cruza la base con los almacenes y **falla con la lista** si algo no cuadra:

- **Originales** (`UploadBatch`): los lotes en `QUEUED`, `PREPARING`, `READY`, `ACTIVATION_QUEUED`, `ACTIVATING`, `COMPLETED` o `REVERTED` deben tener su archivo en `files/` con el tamaño y el SHA-256 registrados. Si faltan, la copia **no se crea**. Excepción explícita y registrada: `--aceptar-originales-ausentes` (queda en el manifiesto y como aviso; úselo solo si sabe por qué faltan).
- **Exportaciones** (`ExportFile`): las de trabajos `READY` deben existir con sus bytes y checksum. Una exportación `READY` ya pasada de su fecha pero **aún no barrida** por el trabajador se **copia** (para no dejar nunca un `READY` sin archivo) y se avisa; la herramienta **no amplía** ninguna vida útil. Las `EXPIRED` no tienen archivo y siguen caducadas.
- **Se clasifican y excluyen**: `tmp/` y `incoming/` (intentos caídos o subidas en vuelo), sondas `.sonda-*`, archivos huérfanos sin fila en la base, nombres que no son un identificador interno y **enlaces simbólicos** (no se siguen: se ignoran con aviso). Todo queda en `excluded` del manifiesto.
- **Marcas de instalación** (`.csapp-store.json`): una marca de otra instalación (carpeta equivocada) hace fallar la copia; un almacén sin marca se copia con aviso.

## 4. Contenido de la copia

Carpeta `csapp-backup-<fecha>-<id>/` dentro del destino, publicada **por renombrado** desde `.tmp-<id>` solo cuando todo está completo y verificado:

```
manifest.json            id, SHA y versión de la aplicación, versiones de PostgreSQL (servidor y pg_dump) y de Node, fecha,
                         migraciones aplicadas, installationId, inventario relativo con bytes y SHA-256 (volcado incluido),
                         recuentos, suma de identidades y suma de contenido de TODAS las tablas, disparadores, exclusiones y avisos
manifest.sha256          SHA-256 del manifiesto
config-inventory.json    NOMBRES de variables de configuración y cuáles se custodian por canal seguro aparte (nunca valores)
db/csapp.dump            pg_dump -Fc --no-owner --no-acl
uploads/files/<id>       originales (copia por bloques, con SHA-256)       uploads/.csapp-store.json
exports/files/<id>       exportaciones vigentes                             exports/.csapp-store.json
```

Si la copia se interrumpe (fallo de `pg_dump`, falta de espacio, corte, Ctrl+C), **no aparece como copia recuperable**: queda como mucho un `.tmp-<id>` propio (que `backup:verificar` y `backup:restaurar` rechazan) y se limpia solo lo propio. Un `.tmp-` abandonado por un `kill -9` puede borrarse a mano; la herramienta **no borra copias**. El espacio libre se comprueba **antes** de empezar (estimación: base + archivos + 5 % + 64 MB; la salida indica el espacio necesario).

## 5. Custodia de la configuración (fuera de la copia)

La copia **no** contiene `.env`, ni `DATABASE_URL`, ni `BETTER_AUTH_SECRET`, ni ningún valor. `config-inventory.json` lista los **nombres** para que quien restaure sepa qué reunir. `DATABASE_URL` y `BETTER_AUTH_SECRET` se custodian por un **canal seguro distinto** de la copia de datos. La instalación restaurada usa **su propio** secreto (el del origen no se reutiliza ni se cambia): las cookies de sesión del origen dejan de valer en ella.

## 6. Verificar

`npm run backup:verificar -- "<copia>"` recalcula por bloques el SHA-256 de todo el inventario, valida el manifiesto (su SHA, su forma, su versión de formato), comprueba que el volcado es legible (`pg_restore --list`, sin restaurar), que las migraciones del manifiesto son compatibles con el código instalado y que ninguna ruta del inventario escapa de la carpeta (`..`, rutas absolutas POSIX/Windows, barras invertidas, enlaces simbólicos). Salida `OK`/`FALLO`/`AVISO` por comprobación.

Compatibilidad de esquema, con mensajes distintos: **igual** (OK) · **más antiguo** que el código (AVISO: hay que aplicar `npm run db:migrar` tras restaurar; `restaurar` exige `--permitir-esquema-anterior`) · **más nuevo** o **divergente** (FALLO: restaure con la versión de la aplicación que la creó).

## 7. Restaurar

Solo en una base y carpetas **nuevas, vacías y aisladas**. Todo se valida **antes de mutar nada**: manifiesto, integridad completa, compatibilidad y destino. Se **rechaza** (con pruebas que demuestran que no se tocó nada): copia corrupta o truncada, manifiesto alterado, formato o esquema incompatible, destino igual al origen operativo (`DATABASE_URL`) o a `cs_app`, nombre que no sea `cs_app_<algo>` (un ensayo, `--nuevo-origen`, exige `cs_app…_test`), base existente con **cualquier** objeto de usuario, carpetas no vacías o dentro de las del origen, de la aplicación, de la copia o una dentro de la otra, rutas del inventario que escapan o enlaces, servidor destino más antiguo que el de la copia, parámetros de conexión que redirijan a otra base.

Tras `pg_restore --single-transaction` (o entra todo o no entra nada) **no basta el código de salida**: se comprueban migraciones aplicadas, recuento + suma de identidades + suma de contenido de cada tabla frente al manifiesto, disparadores (revisiones de configuración inmutables: se prueba que una modificación real es rechazada, en una transacción revertida), claves foráneas validadas y sin huérfanas, SHA-256 de los archivos copiados, que todo archivo referenciado existe con su checksum y que ningún `ExportFile`/`READY` apunta a un archivo inexistente. La identidad efectiva del destino se verifica con la conexión (`current_database()`, puerto) y, en un ensayo, con el guard de pruebas.

- `--nuevo-origen` (**obligatorio para un ensayo**): genera un **nuevo `installationId`**, reescribe las marcas `.csapp-store.json` de los almacenes restaurados y **elimina las sesiones** (y verificaciones pendientes) de Better Auth restauradas; el informe deja constancia. Sin él, la restauración conserva la identidad y las sesiones del origen y avisa de que no debe usarse a la vez que el origen.
- `--normalizar-trabajos`: si hay trabajos con lease vigente heredado, **solo** se caduca el lease (el trabajador los reclamará y retomará); se registra qué cambió y **jamás** se marca nada como completado. Sin la opción, se avisa y no se toca.
- Si `pg_restore` falla, la transacción única deja la base como estaba (vacía si la creó la herramienta). Si falla una comprobación posterior, el informe lo marca como FALLO y **no debe usarse** la base restaurada; retire esa base manualmente antes de reintentar (la herramienta no borra bases).
- La herramienta **no arranca trabajadores**. Para ponerla operativa: preparar `.env` propio (su `BETTER_AUTH_SECRET`, `DATABASE_URL` destino, `CSAPP_UPLOAD_DIR`/`CSAPP_EXPORT_DIR` restaurados), `npm run db:migrar` si el esquema de la copia era anterior, y arrancar.

## 8. Ensayo de restauración

`npm run ensayo:restauracion` (ver [validación](../validacion/csapp-10-restauracion.md)) instala una instalación de **prueba** sobre `cs_app_bkorigen_test` con datos sintéticos, crea y verifica la copia, restaura en `cs_app_bkrestaurado_test`, arranca la web y el trabajador compilados restaurados y compara vistas, CSV, detalles, cobertura y conciliación con la referencia por HTTP real. Requiere `npm run e2e:build`. Solo toca bases `cs_app_bk…_test` propias. Se ensaya **periódicamente** una restauración real: una copia que nunca se ha restaurado no es una garantía.

## 9. PowerShell y rutas con espacios

Se usan las mismas órdenes npm; las rutas con espacios van entre comillas y se pasan como **un** argumento (sin interpolación). Ejemplo (rutas de ejemplo; **no ensayado en Windows**):

```powershell
# Copia (tras `npm run stop:todo`)
npm run backup:crear -- --destino "D:\Copias CS App" --esperar 120
npm run backup:verificar -- "D:\Copias CS App\csapp-backup-20261102T180000Z-1a2b3c4d"

# Restauración en una base y carpetas nuevas (URL por variable: no queda en el historial)
$env:CSAPP_RESTORE_DATABASE_URL = Read-Host "URL de la base destino"
npm run backup:restaurar -- "D:\Copias CS App\csapp-backup-20261102T180000Z-1a2b3c4d" `
  --uploads "D:\CS App Restaurada\Mis Datos\originales" --exports "D:\CS App Restaurada\Mis Datos\exportaciones" `
  --nuevo-origen --informe "D:\CS App Restaurada\informe-restauracion.json"
Remove-Item Env:CSAPP_RESTORE_DATABASE_URL
```

Las rutas se tratan con `node:path` (no a mano) y las rutas del inventario de la copia son siempre relativas con `/`; las absolutas de Windows (`C:\…`), `..` y barras invertidas se rechazan. Pendiente de comprobar en Windows: ejecutables `.exe` de PostgreSQL en `CSAPP_PG_BIN`, rutas largas (>260), antivirus bloqueando el renombrado final y permisos de la carpeta de estado.

## 10. Límites conocidos

- **Parada obligatoria.** No hay copia en caliente ni incremental. Con volúmenes grandes, la ventana de indisponibilidad crece con la base y los almacenes.
- **Una sola máquina y un solo directorio de estado.** El bloqueo `backup.lock` y la comprobación del supervisor suponen que `CSAPP_STATE_DIR` es el mismo para la copia y para `ops iniciar`. No protege frente a un arranque en otra máquina contra la misma base (eso lo detecta el latido de `WorkerInstance`).
- **Sin cifrado ni firma.** La copia no está cifrada ni firmada: el SHA-256 detecta corrupción y alteraciones accidentales, no a quien pueda reescribir manifiesto **y** archivos. Proteja la carpeta (permisos, cifrado de disco, canal de custodia).
- **Destino de restauración local al servidor PostgreSQL elegido.** No restaura entre versiones mayores más antiguas; no convierte codificaciones ni *locales*: la base se crea con los valores por defecto del servidor.
- **Auditoría.** La restauración deja constancia en su informe; no escribe un `AuditEvent` (esa tabla exige una persona autora y no hay actor de sistema).
- **Sin pruebas** en Windows, con un servidor PostgreSQL remoto/gestionado, ni con volúmenes de producción reales.

## 11. Opciones para IT (no son decisiones tomadas)

Estas son **opciones** para que IT decida; ninguna está implantada ni programada por la aplicación, y **no se afirma ningún RPO/RTO**.

- **Frecuencia.** Por ejemplo, una copia tras cada ventana de cargas importantes y/o una copia periódica fuera de horario, según cuánto trabajo reintroducible (cargas, decisiones manuales) se esté dispuesto a repetir. El ensayo aporta el tiempo de copia/restauración **de la máquina de prueba** como punto de partida para dimensionar la ventana.
- **Custodia.** Copia en un volumen distinto del de la base y los almacenes y, si se desea, una segunda copia fuera de la máquina; `DATABASE_URL` y `BETTER_AUTH_SECRET` por un canal separado del de los datos.
- **Acceso.** Quién puede leer las copias (contienen datos de clientes), quién puede restaurarlas y desde qué cuenta; la herramienta usa las credenciales de la base indicadas en `DATABASE_URL`.
- **Retención.** Cuántas copias conservar y durante cuánto tiempo, y quién las retira. La herramienta **no borra** copias: la limpieza sería un procedimiento explícito y aprobado por IT.
- **Comprobación periódica.** Repetir `backup:verificar` y un ensayo de restauración con la cadencia que IT fije.
