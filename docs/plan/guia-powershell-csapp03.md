# Guía PowerShell de CSAPP-03: migrar, arrancar y probar los importadores de tickets y tiempos

Escrita para Windows 10/11 con PowerShell, Node.js 22 LTS y PostgreSQL ≥13 local. **No se ha ejecutado en Windows**: lo probado es Linux (ver [validación](../validacion/csapp-03.md)). Parte de que [CSAPP-01](guia-powershell-csapp01.md) y [CSAPP-02](guia-powershell-csapp02.md) ya funcionan (`.env`, base `cs_app`, almacén privado de cargas, cuentas). Todo desde la carpeta del repositorio. No se imprime ninguna credencial. **No se precarga ningún dato: los primeros XLSX reales los carga usted.**

## 1. Actualizar sin borrar nada

```powershell
git pull
npm ci
npm run db:comprobar
npm run db:migrar
```

`db:migrar` aplica solo la migración incremental `20261030080000_zendesk_tickets_y_tiempos` (tablas de tickets, revisiones, observaciones, registros de tiempo, correcciones y decisiones, y el valor `REDERIVE` de los trabajos). No hace reset ni toca sus maestros, personas ni usuarios.

## 2. Construir y arrancar web y trabajador (dos terminales)

Terminal 1: `npm run build` y `npm start`. Terminal 2: `npm run worker` (si ya tenía un trabajador en marcha, deténgalo con `Ctrl+C` y arránquelo de nuevo: debe ser la versión nueva). Ambos usan el mismo `CSAPP_UPLOAD_DIR`. Recuperación: [guía del trabajador](guia-trabajador-cargas.md).

## 3. Comandos de prueba (solo contra una base de test explícita)

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run e2e:build
npm run e2e
```

`npm test` incluye las pruebas de Zendesk con PostgreSQL real; `npm run e2e` el recorrido de navegador (incluye ambos importadores y las acciones Cancelar, Reprocesar y Revertir). Pruebas largas (trabajador real, reinicios y volumen de ≈114 000 tickets y ≈250 000 tiempos, varios minutos y varios GB de disco temporal): `npm run test:largo`. Subida web de volumen por el navegador: `npm run e2e:volumen` (variables `TICKETS` y `TIMES` para cambiar el tamaño; usa la base de test). Ninguna prueba apunta a `cs_app`.

## 4. Primer uso real (sus XLSX)

1. **Maestros.** Antes o después, según disponga de ellos: equivalencias de organización Zendesk → Cliente (Maestros) y personas con su ID o alias de Zendesk y su pertenencia a PMO con vigencias (Personal). No hace falta completarlos antes de cargar: los datos sin equivalencia se reciben y se muestran **sin atribuir** (no como horas cero de ningún Cliente).
2. **Arranque.** Web y trabajador como en el apartado 2, con el almacén privado configurado.
3. **Tickets.** Administración › Cargas › «Zendesk · tickets»: elija el XLSX canónico de ocho campos y, si la conoce, la **fecha de extracción** (sin ella, la observación se registra con la fecha de recepción y se avisa de frescura desconocida). Revise esquema, resumen (nuevos, revisados, sin cambios, observaciones, organizaciones pendientes, internos/externos, clasificación incompleta) y confirme. Un libro con varias hojas compatibles pide indicar la hoja; un export antiguo sin `status` se rechaza con el motivo.
4. **Tiempos.** «Zendesk · tiempos»: suba el XLSX de once campos. Revise la tabla de horas por motivo (duplicadas, excluidas por PMO desde el 01/01/2025, sin ticket, sin persona, atribuibles) y que reconcilia; decida, si aparecen, las posibles correcciones (mismo id y contexto, otra duración) y confirme. Las horas PMO posteriores a 2025 **no se toman de Zendesk**: llegarán de Wrike en la entrega 04.
5. **Repetir.** Suba otra vez ambos archivos: no se duplican entidades, revisiones ni horas. Complete una equivalencia o un alias en Maestros/Personal y use **Reprocesar** en el lote de tiempos completado: se recalcula la atribución sin tocar el archivo.
6. **Consultar y probar acciones.** Desde la ficha abra tickets y registros, filtre por motivo y llegue a la fila de origen. Con un lote de prueba propio compruebe **Cancelar** antes de activar y **Revertir** después (solo retira lo que ningún otro lote aporta).

Las vistas analíticas (Comparativa, Calidad, backlog, semáforos) todavía no usan estos datos: llegan en entregas posteriores.

## 5. Límite de esta guía

No se ha ejecutado en Windows. Si un comando falla, avise con el mensaje (sin credenciales).
