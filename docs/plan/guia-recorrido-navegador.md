# Recorrido de navegador reproducible (CSAPP-01 y base para nuevas pantallas)

El informe de CSAPP-01 declaró 41 comprobaciones con Chromium cuyo guion no se versionó y no se ha podido recuperar del entorno. Este recorrido es una **reimplementación nueva** de los casos esenciales: no equivale a «las 41 originales». Ejecutado en Linux (Node 22.22, PostgreSQL 16.15, Chromium preinstalado): 40 comprobaciones, todas correctas. **No probado en Windows/PowerShell.**

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
| `99-extensiones` | Punto de extensión vacío para Personal, Usuarios y Cargas |

La mutación forjada reproduce los campos ocultos reales del formulario (`$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`, `$ACTION_KEY`) leídos de una página de Administrador y los envía con la cookie del perfil probado y la cabecera `Origin` de la aplicación; el resultado se verifica en la base. El cupo de acceso (5 por minuto y origen) se vacía antes de cada login para no falsear resultados; solo el caso del límite lo agota, y va el último.

## Comandos (Linux)

```bash
npm ci
npm run e2e:build
npm run e2e
```

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
