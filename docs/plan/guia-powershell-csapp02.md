# Guía PowerShell de CSAPP-02: migrar, configurar, arrancar web y trabajador, probar

Escrita para Windows 10/11 con PowerShell, Node.js 22 LTS y PostgreSQL ≥13 local. **No se ha ejecutado en Windows**: lo probado es Linux (ver [validación](../validacion/csapp-02.md)). Si un comando falla, avisar. Parte de que [CSAPP-01](guia-powershell-csapp01.md) ya funciona (`.env`, base `cs_app`, cuentas). Todo desde la carpeta del repositorio. No se imprime ninguna credencial.

## 1. Actualizar sin borrar nada

```powershell
npm ci
npm run db:comprobar
npm run db:migrar
```

`db:migrar` aplica solo la migración incremental nueva (`20261029220244_personal_usuarios_cargas`) sobre `cs_app`; no hace reset ni borra datos. Añade roles PMO iniciales ANA y DEV al catálogo y no crea ningún dato de negocio.

## 2. Configurar el directorio privado de cargas

Directorio persistente, fuera de `public` y de Git, **el mismo para web y trabajador**. Añadir a `.env` la línea `CSAPP_UPLOAD_DIR="C:\datos\cs-app\almacen-cargas"` (otros límites opcionales: ver `.env.example`) y crearlo:

```powershell
New-Item -ItemType Directory -Force -Path "C:\datos\cs-app\almacen-cargas" | Out-Null
notepad .env
```

No definir `CSAPP_ENABLE_SYNTHETIC_PROFILES` en la base de trabajo: esa variable solo existe para pruebas aisladas.

## 3. Construir y arrancar los dos procesos (dos terminales)

Terminal 1, web:

```powershell
npm run build
npm start
```

Terminal 2, trabajador (construye `worker-dist/worker.mjs` con esbuild y lo arranca; no necesita `next dev`):

```powershell
npm run worker
```

Detener: `Ctrl+C` en cada terminal. Reanudar: `npm start` y `npm run worker:start` (el trabajador retoma lo pendiente). Detalles de recuperación: [guía del trabajador](guia-trabajador-cargas.md).

## 4. Pruebas aisladas (solo contra una base de test explícita)

Crear una base de pruebas distinta de `cs_app`, con nombre acabado en `_test`, y apuntar a ella solo en la sesión actual (la contraseña se escribe en la URL de esa variable; no la guarde en archivos versionados):

```powershell
createdb -U postgres -O csapp cs_app_test
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
```

Pruebas largas del trabajador real y de volumen (varios minutos):

```powershell
npm run test:largo
```

Recorrido de navegador (Chromium con Playwright, sobre `next start` y la base de test; ver [guía del recorrido](guia-recorrido-navegador.md)):

```powershell
npm run build
npm run e2e
```

Medición de los lectores con archivos sintéticos: `npm run benchmark:lectores`.

## 5. Recorrido breve para Dennis

1. **Personal.** Administración › Personal: crear una persona de prueba («PRUEBA Persona»); añadir alias PAP (nombre y correo), Zendesk (ID numérico inventado) y Wrike (opcional). Intentar el mismo ID Zendesk en otra persona y comprobar que se explica el conflicto. Registrar equipo y nivel (antes, en el catálogo, dar de alta algún valor) y «Pertenece a PMO»: sí con rol ANA desde una fecha; después cambiar a no con una fecha posterior y comprobar que el rol deja de mostrarse como vigente y que la historia se conserva. Revisar el historial.
2. **Usuarios (matriz).** Administración › Usuarios: elegir el año en curso y Grupo Cliente (o Cliente) de un maestro existente. Inicializar el 2025 de un ámbito con un valor inicial (queda bloqueado) y copiar a 2026 si procede. Registrar usuarios del año en curso, **editar un mes** y **aplicar desde otro mes** viendo la vista previa (meses que cambian y meses protegidos), p. ej. 65 hasta mayo y 68 desde junio. Abrir un año anterior (solo consulta) e intentar editar 2025 inicializado (rechazado). Entrar como Consulta: ve la matriz sin formularios.
3. **Cargas.** Administración › Cargas (solo Administrador): se ven las fuentes futuras como pendientes y el historial vacío. **El primer importador operativo será el de CSAPP-03**; en esta fase el motor se prueba con el perfil sintético, que solo existe en el entorno de pruebas aislado (no en su base de trabajo). No suba todavía sus archivos grandes. Para ver el motor funcionando use las pruebas aisladas del apartado 4.
