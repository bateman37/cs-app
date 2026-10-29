# Base web, acceso y configuración (CSAPP-01)

Resultado de [CSAPP-01-v1](../../prompts/CSAPP-01-v1.md). Complementa la [propuesta](propuesta.md); el esquema físico está en [modelo físico](modelo-fisico-csapp01.md) y la guía de uso en [PowerShell y prueba manual](../plan/guia-powershell-csapp01.md).

## Versiones elegidas (29/10/2026)

| Pieza | Versión | Motivo |
| --- | --- | --- |
| Node.js | 22.x LTS (probado con 22.22.0); `engines`: ≥22.18 <23 o ≥24.11 | Node 22 figura como LTS en la página oficial de versiones; cumple los requisitos de Better Auth y Vitest |
| Next.js / React | 16.4.3 / 19.3.1 | Última estable; App Router, Server Actions y `proxy.ts` |
| TypeScript | 5.9.3 | Se evita TypeScript 7 (compilador nativo, recién publicado) hasta comprobar la cadena Next/Prisma/ESLint |
| Prisma | 7.10.1 (cliente y adaptador `pg`) | La etiqueta `latest` de npm apunta a 8.0 en candidata (rc): no se adopta; 7.10.1 es la última estable |
| Autenticación | Better Auth 1.7.14 | Mantenida, compatible con Next y Prisma; sesiones en base de datos |
| Validación | zod 4.6.7 | |
| PostgreSQL | probado 16.15; se requiere ≥13 (extensión `btree_gist`, de confianza desde 13) | |
| Pruebas / lint | Vitest 5.0.5, ESLint 9.39.5 (ESLint 10 no adoptado) | |

Gestor único: npm 10 con `package-lock.json` versionado y `save-exact`. Lectores añadidos en CSAPP-02 (versiones exactas): `csv-parse` 7.0.3, `yauzl` 3.4.0 y `saxes` 6.0.0 (ver [lectores](lectores-xlsx-csv.md)); en desarrollo `esbuild` 0.28.2 (construye el trabajador), `yazl` 3.3.1 (genera XLSX de prueba) y `playwright` 1.63.0 (recorrido de navegador). No se actualizó ninguna dependencia previa. Verificación de versiones: página oficial de ramas de Node consultada; la documentación de requisitos de Prisma no era accesible desde la sesión de implementación, por lo que se usaron los metadatos de paquetes en npm (`engines`, `peerDependencies`).

## Variables (archivo `.env`, no versionado; modelo en `.env.example`)

`DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 caracteres al azar), `BETTER_AUTH_URL`; solo desarrollo/pruebas: `TEST_DATABASE_URL`, `SHADOW_DATABASE_URL`. `src/lib/env.ts` valida y explica los fallos sin mostrar valores. El nombre de la base debe ser `cs_app` o `cs_app_*`; cualquier otro (gamification-vcs, V-apps, beM…) se rechaza.

## Bases de datos

`cs_app` (trabajo), `cs_app_test` (pruebas; el nombre debe acabar en `_test` y ser distinta de `DATABASE_URL`, o las pruebas abortan) y opcionalmente `cs_app_shadow` (solo para `prisma migrate dev`). `npm run db:comprobar` muestra el destino sin credenciales. Las migraciones son incrementales (`prisma/migrations`) y se aplican con `npm run db:migrar` (`prisma migrate deploy`); no hay reset, drop ni `db push`. No hay semillas ni precarga: ningún proceso inserta clientes al arrancar.

## Acceso y permisos

Correo y contraseña locales con Better Auth: sin registro público, proveedores sociales ni correos. Hash scrypt de la librería; sesión de 8 horas en base de datos (cerrar sesión la elimina y la cookie deja de valer); cookies `httpOnly`, `SameSite=lax`, `Secure` si la URL es https; límite de 5 intentos de acceso por minuto y origen (detrás de un proxy inverso debe reenviar `X-Forwarded-For`); origen de confianza único; las Server Actions comprueban además Origin/Host. Cuentas: `npm run cuenta:crear` (contraseña pedida sin eco; nunca por argumento); es idempotente y no modifica una cuenta existente. No hay contraseñas predeterminadas.

| Perfil | Puede |
| --- | --- |
| Administrador | Crear, editar, desactivar/reactivar maestros, equivalencias, vigencias, hitos y productos; consultar historial |
| Consulta | Leer los maestros; sin mutaciones ni historial |

Autorización en servidor en tres niveles: `proxy.ts` (redirección optimista sin cookie), páginas (`requirePageUser/Admin`) y cada servicio y acción (`authorize` contra la base: rol y estado vigentes). Las cabeceras impiden cachés compartidas (`private, no-store`). Las cuentas de acceso no son PERSONAL ni usuarios contratados.

## Estructura

`src/domain` (catálogos, normalización, vigencias, esquemas de validación; sin dependencias de servidor), `src/server` (reglas y persistencia con auditoría atómica), `src/app` (interfaz y acciones), `src/lib` (entorno, conexión, sesión), `tests`, `scripts`. El logotipo oficial no está en el repositorio: la cabecera usa texto; añadirlo cuando se facilite.

## Comprobaciones

Ver [resultados de CSAPP-01](../validacion/csapp-01.md). Nota: `next dev` puede añadir por sí mismo un bloque a AGENTS.md cuando detecta un agente de IA; no se versiona ese cambio.
