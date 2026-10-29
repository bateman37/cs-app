# Guía PowerShell y prueba manual de CSAPP-01

Escrita para Windows 10/11 con PowerShell, Node.js 22 LTS y PostgreSQL ≥13 local (sin Docker). **No se ha ejecutado en Windows**: si un comando falla, avisar. Todo desde la carpeta del repositorio.

## 1. Instalar

```powershell
node -v
npm ci
```

## 2. Base de datos exclusiva (una sola vez)

Las contraseñas se piden en pantalla; no se escriben en los comandos.

```powershell
createuser -U postgres --pwprompt csapp
createdb -U postgres -O csapp cs_app
```

## 3. Configurar `.env`

```powershell
Copy-Item .env.example .env
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
(Get-Content .env) -replace 'BETTER_AUTH_SECRET=""', ('BETTER_AUTH_SECRET="' + [Convert]::ToBase64String($b) + '"') | Set-Content .env
notepad .env
```

En el Bloc de notas, poner usuario y contraseña en `DATABASE_URL` (base `cs_app`) y borrar o ignorar `TEST_DATABASE_URL`. `.env` no se versiona.

## 4. Comprobar y migrar (no borra nada)

```powershell
npm run db:comprobar
npm run db:migrar
```

## 5. Crear las dos cuentas (pide correo, nombre, rol y contraseña oculta de 12+ caracteres)

```powershell
npm run cuenta:crear
npm run cuenta:crear
```

Primera vez rol `admin`; segunda `consulta`. Repetir con un correo existente no cambia nada.

## 6. Arrancar

Desarrollo: `npm run dev`. Producción local: `npm run build` y después `npm start`. Abrir http://localhost:3000. Parar con Ctrl+C y volver a arrancar con el mismo comando. Para otro puerto: `npm start -- -p 3100` (y poner la misma URL en `BETTER_AUTH_URL`).

## Prueba manual (unos minutos)

1. Entrar como administrador. Comprobar el menú: Comparativa, Análisis Cliente, Pulse Rent, Calidad (cada una indica que aún no está disponible) y Administración.
2. Administración › Clientes › Grupos Cliente › Nuevo grupo (p. ej. «PRUEBA Grupo»).
3. En su ficha, «Añadir cliente a este grupo»: crear «PRUEBA Cliente 1» y «PRUEBA Cliente 2».
4. En el Cliente 1: añadir equivalencia Zendesk (ID numérico inventado) y una PAP; intentar el mismo ID Zendesk en el Cliente 2 y comprobar que se explica el conflicto.
5. Datos de servicio: «Cambiar un dato con fecha efectiva»: Servidor OP con «fecha de inicio desconocida»; después CLOUD con fecha efectiva 01/06/2026. En «Situación a una fecha» comprobar OP el 31/05/2026 y CLOUD el 01/06/2026.
6. Añadir un hito (migración cloud) y revisar el historial de cambios (actor, fecha, antes/después).
7. Desactivar el Cliente 2 y reactivarlo; sigue consultable con su historial.
8. Entrar con la cuenta de consulta (otro navegador): se ven los maestros pero no hay botones de edición ni historial. Cerrar sesión en ambos.

**Retirar los datos de prueba sin borrar historia:** desactivar los Clientes de prueba y después el grupo (botón «Desactivar» de cada ficha), y desactivar sus equivalencias e hitos. Los registros inactivos se conservan, no se ofrecen para nuevas asignaciones y se ocultan de las listas por defecto (filtro Estado › Todos para verlos). No hay borrado.
