# Guía PowerShell de CSAPP-04: migrar, arrancar y probar Wrike, PAP y bugs VFS/VSW

Escrita para Windows 10/11 con PowerShell, Node.js 22 LTS y PostgreSQL ≥13 local. **No se ha ejecutado en Windows**: lo probado es Linux (ver [validación](../validacion/csapp-04.md)). Parte de que [CSAPP-01](guia-powershell-csapp01.md), [CSAPP-02](guia-powershell-csapp02.md) y [CSAPP-03](guia-powershell-csapp03.md) ya funcionan. Todo desde la carpeta del repositorio. No se imprime ninguna credencial. **No se precarga ningún dato: los archivos reales los carga usted.**

## 1. Actualizar sin borrar nada

```powershell
git pull
npm ci
npm run db:comprobar
npm run db:migrar
```

`db:migrar` aplica solo `20261030120000_wrike_pap_bugs`: tablas de Wrike, PAP y Work Items, la vista común de dedicación y dos columnas nuevas (`derived` en el staging y `targetRevision` en las decisiones de corrección). No hace reset ni toca maestros, personal, usuarios ni lo cargado de Zendesk.

## 2. Reiniciar web y trabajador (dos terminales)

Terminal 1: `npm run build` y `npm start`. Terminal 2: detenga con `Ctrl+C` el trabajador anterior y ejecute `npm run worker` (debe ser la versión nueva). Opcional, en `.env`: `CSAPP_ZENDESK_HOSTS` (hosts Zendesk reconocidos en URLs; por defecto `vincle.zendesk.com`), `CSAPP_DEVOPS_PRODUCTS` (`VFS=ProyectoA,ProyectoB;VSW=ProyectoC`, para resolver el producto de URLs de DevOps en `Nº de BUG`) y `CSAPP_BUG_TERMINAL_STATES` (estados terminales explícitos de bugs, separados por `;`; por defecto ninguno).

## 3. Comandos de prueba (solo contra una base de test explícita)

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test
npm run e2e:build
npm run e2e
npm run test:largo
```

`npm run test:largo` incluye el volumen del circuito de CSAPP-04 (variables `CSAPP_TEST_WRIKE`, `CSAPP_TEST_PAP`, `CSAPP_TEST_VFS` y `CSAPP_TEST_VSW` para cambiar los tamaños). Ninguna prueba apunta a `cs_app`.

## 4. Primer uso real

1. **Equivalencias de PERSONAL y de proyectos.** En Personal: alias o ID **de Wrike** de cada persona, su pertenencia a PMO con vigencias y su rol (ANA/DEV). En Maestros › Clientes: equivalencias de **proyecto Wrike** y de **proyecto PAP** a Cliente o implantación; un proyecto que solo identifica un Grupo Cliente se declara con la clave BC del grupo. Los maestros vacíos permiten recibir los archivos pero dejan la atribución **pendiente**: no equivale a actividad cero.
2. **Wrike.** Administración › Cargas › «Wrike»: suba el CSV original **sin abrirlo ni pegarlo en Excel**. Revise la partición de filas y horas (conciliada), las tareas sin imputación, el origen del ticket (explícito, inferido, pendiente, ambiguo), los conflictos y el rol ANA/DEV. Confirme.
3. **PAP.** «PAP»: suba el XLSX CARGA PAP (la consulta IQY no se ejecuta) e indique la **lista de origen** de los IDs (por ejemplo `pap-principal`; use siempre la misma para la misma lista). Revise PAP distintos, correctivos únicos, origen cliente, fechas, resultados y referencias pendientes. Confirme.
4. **Bugs.** «Bugs VFS» y «Bugs VSW» por separado: elija la **vista** que contiene cada listado (abiertos, intervalo o amplia) y, si la conoce, la fecha de extracción y la cobertura. Revise Bug_ por estado, tipos, vínculos con tickets y los elementos no observados.
5. **Repetir los archivos.** Súbalos otra vez: no se duplican imputaciones, PAP, revisiones ni Work Items (solo se añade la observación).
6. **Completar una correspondencia y Reprocesar.** Añada un alias de persona, una equivalencia de proyecto o cargue los tickets que faltan; en el lote completado pulse **Reprocesar**: se recalculan relaciones y atribución sin releer el archivo ni mover fechas.
7. **Correcciones sin ID.** En un lote Wrike (o de tiempos Zendesk) listo para revisar, «Relacionar con un registro» en una fila: localice el registro activo con los filtros, compare, marque la confirmación y confirme la sustitución. Compruebe que la duración se sustituye y no se suma.
8. **Vínculos de bugs.** En un lote de bugs completado, «Ver y revisar vínculos» en un elemento: confirme o rechace un vínculo con un ticket.
9. **Reversión.** Pruébela con un lote propio de prueba: solo retira lo que ningún otro lote sustenta.

Las vistas analíticas todavía no usan estos datos: llegan en entregas posteriores.

## 5. Límite de esta guía

No se ha ejecutado en Windows. Si un comando falla, avise con el mensaje (sin credenciales).
