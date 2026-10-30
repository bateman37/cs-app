# Recorrido de navegador reproducible (CSAPP-01 y base para nuevas pantallas)

El informe de CSAPP-01 declaró 41 comprobaciones con Chromium cuyo guion no se versionó y no se ha podido recuperar del entorno. Este recorrido es una **reimplementación nueva** de los casos esenciales: no equivale a «las 41 originales». Ejecutado en Linux (Node 22.22, PostgreSQL 16.15, Chromium preinstalado): 40 comprobaciones de CSAPP-01 más 27 de Administración › Cargas (CSAPP-02), 67 en total, todas correctas en dos ejecuciones seguidas. Con Personal y usuarios (CSAPP-02) y los importadores de CSAPP-03 el recorrido completo llega a 121 comprobaciones (43 de Zendesk), correctas en la última ejecución. **No probado en Windows/PowerShell.**

## Qué hace

`scripts/e2e/recorrido.ts` (núcleo en `nucleo.ts`, casos en `casos/`):

1. Exige `TEST_DATABASE_URL` con una base cuyo nombre acaba en `_test` y distinta de `DATABASE_URL`; aplica migraciones (`prisma migrate deploy`) y vacía solo esa base.
2. Crea con `provisionAccount` un Administrador y un Consulta sintéticos, con contraseñas al azar en cada ejecución (no se imprimen ni se versionan).
3. Arranca `next start` (build de producción) en el puerto 3101 contra la base de test y lo detiene al terminar, también ante error.
4. Ejecuta los casos y devuelve código de salida distinto de 0 si falla alguno.

| Módulo | Comprobaciones |
| --- | --- |
| `01-cuentas` | La cuenta provisionada tiene `accountId` igual al ID de usuario y `providerId` credential (defecto de CSAPP-01) |
| `02-acceso` | Sin sesión (cinco rutas, incluida Administración) → `/login`; POST directo sin sesión no crea datos; cookie falsa sin bucle; contraseña incorrecta con mensaje genérico; login real; menú con las cuatro vistas; sesión creada en base; las cuatro vistas sin cifras ni tablas |
| `03-maestros` | Alta real de Grupo y Cliente por la web; nombre vacío y duplicado (otra capitalización) rechazados; auditoría con autor |
| `04-consulta` | Control positivo: la petición forjada de Server Action con sesión de Administrador **sí** crea; la misma con sesión de Consulta y sin sesión **no** crea ni audita; Consulta lee pero no ve controles de edición ni historial; no llega al formulario de alta; cierre de sesión borra la sesión en base y la cookie anterior deja de valer |
| `05-persistencia` | Tras reiniciar `next start`, la sesión (en base de datos) y los datos siguen |
| `06-limite-intentos` | Los intentos de acceso fallidos se limitan (429) y, bloqueado el origen, ni la contraseña correcta entra |
| `07-cargas` (CSAPP-02) | Con el motor real: Consulta sin acceso (pantalla, pestaña y subida forjada 403 sin lote); Administrador ve fuentes y pendientes; subida por la interfaz (queda «En cola» sin trabajador); con el trabajador construido la ficha pasa sola a «Listo para revisar» (sondeo), contadores, previsualización y filtro; confirmar y activar; repetir el archivo avisa del checksum y no duplica; cabeceras equivocadas → rechazado; historial y filtros |
| `09-zendesk` (CSAPP-03) | Circuito real de Tickets y Tiempos con XLSX sintéticos y trabajador construido: fuentes disponibles y resto pendientes; subida por la interfaz, validación, resumen conciliable, filtro por motivo y detalle de ticket; confirmar y activar; segunda extracción con revisión y observación; **Cancelar** antes de activar; **Reprocesar** (lote listo y lote completado tras completar un maestro); **Revertir** (restituye una corrección y retira solo lo propio); formato antiguo rechazado; errores obligatorios que bloquean confirmar; posible corrección con decisión explícita auditada; Consulta y sin sesión no leen estado ni archivo |
| `10-wrike-pap-bugs` (CSAPP-04) | Circuito real de Wrike, PAP y bugs VFS/VSW con corrección explícita sin ID, Reprocesar, revisión de vínculos y permisos |
| `11-finanzas` (CSAPP-05) | Circuito real de facturación anual y motor económico con XLSX sintéticos y trabajador construido: tres fuentes disponibles y ninguna pendiente; soporte/administración delegada/otros 2026; bloqueo por importes sin asignar y aceptación expresa; impacto de la sustitución; repetición (15.000 €, no 30.000); sustitución con retirada (12.600 €); reversión del vigente y no reversión de un sustituido; vacío de Vta Potencial con decisión y motivo; comprobación económica (12.000 anuales con corte 15/30 → 500,00 €; mes completo 1.000,00 €); configuración con edición obsoleta y revisión anterior identificada; asignaciones de servicio con rechazo de solapes; permisos de Consulta y petición forjada |
| `99-extensiones` | Punto de extensión vacío para Personal, Usuarios y Cargas |

La mutación forjada reproduce los campos ocultos reales del formulario (`$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`, `$ACTION_KEY`) leídos de una página de Administrador y los envía con la cookie del perfil probado y la cabecera `Origin` de la aplicación; el resultado se verifica en la base. El cupo de acceso (5 por minuto y origen) se vacía antes de cada login para no falsear resultados; solo el caso del límite lo agota, y va el último.

## Comandos (Linux)

```bash
npm ci
npm run e2e:build   # build de Next y del trabajador (worker-dist)
npm run e2e
```

El recorrido habilita los perfiles sintéticos **solo** porque `TEST_DATABASE_URL` es una base `_test` comprobada: crea el esquema `csapp_synthetic` en ella, usa un directorio temporal como almacén (`CSAPP_UPLOAD_DIR`, borrado al terminar) y arranca/detiene el trabajador desde el propio caso (`ctx.startWorker()`).

Variables opcionales: `E2E_PORT` (3101), `E2E_CHROMIUM` (ruta a un Chromium; si no se indica se usa el de Playwright; en este entorno ya está en `/opt/pw-browsers`, no ejecutar `playwright install`).

## Equivalente PowerShell (escrito, sin probar en Windows)

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm ci
npx playwright install chromium
npm run e2e:build
npm run e2e
```

El script usa `spawn` de Node sin shell, pero su comportamiento en Windows (señales al detener `next start`) no está comprobado.

## Añadir casos

Crear `scripts/e2e/casos/NN-nombre.ts` que exporte `async function (ctx: Ctx)`, registrarlo en `recorrido.ts` antes de `limite`, y usar `login(ctx, email, password)` (de `casos/util.ts`) y `ctx.check(etiqueta, ok, detalle)`.

## Subida web de volumen (CSAPP-03)

`npm run e2e:volumen` (`scripts/e2e/volumen.ts`) genera por streaming un XLSX de ≈114 000 tickets y otro de ≈250 000 tiempos (variables `TICKETS` y `TIMES`), los sube por el navegador real a `next start`, los prepara y activa el trabajador real, y registra filas, bytes, tiempos de cada fase y pico de memoria (VmHWM de `/proc`, solo Linux) en `E2E_MEASURES_FILE`. Usa la base de test; nada se versiona. Ver las medidas obtenidas en la [validación de CSAPP-03](../validacion/csapp-03.md).


## Ejecutar solo un caso (CSAPP-05)

Para depurar un caso sin repetir el recorrido completo: `E2E_SOLO=finanzas npm run e2e` (nombres separados por comas: `cuentas, acceso, maestros, consulta, persistencia, cargas, personalUsuarios, zendesk, wrikePapBugs, finanzas, extra, limite`). Sin la variable se ejecuta el recorrido completo, que es el que cuenta para la validación. Antes, `npm run e2e:build`. No lance dos recorridos a la vez: comparten el puerto 3101 y la base de test.
