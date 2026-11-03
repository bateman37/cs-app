# Validación de CSAPP-10 §7-8: copia, verificación y restauración

Registro de lo **ejecutado** (02/11/2026) para las herramientas de copia y restauración. Separa lo **observado** (medido o comprobado), lo **implementado**, lo **propuesto/opciones** (no decididas) y lo **no ejecutado**. Guía operativa: [copia-restauracion.md](../operacion/copia-restauracion.md). Todo se ensayó con **datos sintéticos**, sobre bases aisladas `cs_app_bk…_test` propias y almacenes en directorios temporales propios; no se tocó `cs_app`, `cs_app_test`, `cs_app_perf_test` ni `cs_app_shadow`, no se cargó ningún archivo real y no se programó ninguna tarea.

## Sistema y versiones

| Elemento | Valor |
| --- | --- |
| Máquina | Linux 6.18 x64 (Firecracker), Intel Xeon 2,8 GHz, **4 vCPU, 15 GB**, **compartida** con otros dos procesos durante el ensayo (los tiempos incluyen esa carga) |
| Node / PostgreSQL | Node 22.22.0 · PostgreSQL **16.15** (servidor, `pg_dump` y `pg_restore` 16.15) |
| Aplicación | Next.js 16.4.3 (Turbopack), Prisma 7.10.1, Better Auth 1.7.14, Vitest 5.0.5; versión 0.1.0, SHA del código `da38cda63f42` (`build-info.json`, 9 migraciones) |
| Compilado | `npm run e2e:build` (web `.next` y trabajador `worker-dist`) ≈ 69 s |
| Plataforma no ensayada | **Windows, PowerShell, lector de pantalla, PostgreSQL remoto o gestionado**: no ejecutados (ver «No ejecutado») |

## Qué se implementó (comprobado por pruebas y por el ensayo)

- `src/server/ops/backup/` (`create`, `verify`, `restore`, `manifest`, `controls`, `conditions`, `lock`, `pgtools`, `fsutil`, `redact`, `config-inventory`) y `scripts/backup.ts`; scripts npm `backup:crear`, `backup:verificar`, `backup:restaurar`, `ensayo:restauracion`. `backupLockLive(): Promise<boolean>` exportado desde `src/server/ops/backup/lock.ts` para que `ops iniciar` se niegue a arrancar durante una copia (**la integración en `ops iniciar` está pendiente de quien lo mantiene**).
- `pg_dump -Fc` / `pg_restore --single-transaction` con `execFile` sin shell; conexión y contraseña solo por entorno del hijo (`PG*`/`PGPASSWORD`); salida redactada.
- Documentación operativa y esta validación. Ninguna política de frecuencia, custodia, acceso o retención está decidida; no se afirma RPO/RTO.

## Pruebas automáticas (Vitest con PostgreSQL real, base `cs_app_bkorigen_test`)

| Archivo | Pruebas | Qué cubre |
| --- | --- | --- |
| `tests/csapp10-backup-crear.test.ts` | 30 | Manifiesto, inventario con SHA-256, controles por tabla, configuración sin valores; condiciones de parada (web, supervisor, trabajador, trabajos con lease, subida en curso, `--esperar`); bloqueo doble, caducidad por latido y PID muerto; interrupción (pg_dump doble que falla o produce un volcado vacío, señal de cancelación, corte por espacio simulado, espacio insuficiente previo, `.tmp-` abandonado); coherencia (original/ExportFile ausente, alterado, truncado, enlace simbólico, huérfano, READY caducada, marca ajena); destino seguro; redacción de secretos |
| `tests/csapp10-backup-verificar.test.ts` | 10 | Copia íntegra; byte alterado; truncada; archivo ausente; manifiesto alterado/SHA ausente o ilegible; formato no soportado; esquema anterior/nuevo/divergente con mensajes distintos; rutas que escapan (`..`, POSIX/Windows, `\`, prefijos, duplicados), enlaces simbólicos; archivos extra |
| `tests/csapp10-restauracion-completa.test.ts` | 10 | Restauración real con `--nuevo-origen`: contenido = origen salvo identidad/sesiones, ConfigRevision y disparador, archivos con SHA-256, origen intacto, base preexistente vacía, `--normalizar-trabajos` (solo caduca el lease, nunca completa), detección de un manifiesto que no refleja el contenido |
| `tests/csapp10-restauracion-rechazos.test.ts` | 11 | Copia corrupta/truncada, manifiesto alterado, formato/esquema incompatible, rutas que escapan, servidor destino más antiguo, destino = origen / `cs_app` / nombre inválido / parámetros que redirigen, base con datos, carpetas no vacías / dentro del origen o de la app / anidadas / enlaces / sin espacio: **en todos, la base destino no se crea y las carpetas no se tocan** |
| `tests/csapp10-backup-cli.test.ts` | 3 | CLI real: códigos de salida (0/1/2) y ninguna credencial en la salida |
| **Total** | **64 correctas** (5 archivos, ≈ 53 s) | |

`npx tsc --noEmit` sin errores; `npx eslint src/server/ops/backup scripts tests` sin errores ni advertencias. No se ejecutó la suite completa (`npm test`) de la rama: solo estos cinco archivos, que no modifican código existente.

## Ensayo real (`npm run ensayo:restauracion`)

Comando exacto: `npm run ensayo:restauracion -- --salida <resultado.json>` (volumen de referencia, `--filas 30000` por defecto) y `npm run ensayo:restauracion -- --filas 300000 --salida <resultado.json>` (tamaño medio). Requiere `npm run e2e:build`. Origen: base `cs_app_bkorigen_test`, web en 3211; restaurado: `cs_app_bkrestaurado_test`, web en 3212 con **secreto y `BETTER_AUTH_URL` propios** y **modo operativo** (sin variables de prueba). Los directorios temporales llevan **espacios** en el nombre.

**Semilla** (datos sintéticos de 01–09; `seedAnalitica`, `declareAllSources` y fixtures de las pruebas de Calidad/Exportaciones): 36 Grupos Cliente, 6 Clientes con identidades externas; usuarios por mes con valores distintos por ámbito y vigencias de servicio con fechas; tickets con **más de una observación** (166 revisiones, 54 observaciones); tiempos Zendesk (30 112 / 300 112 filas) y Wrike; finanzas con **sustitución atómica y su predecesora enlazada**; 4 `ConfigRevision` (activaciones reales de Calidad y Pulse); Client Health (2 celdas); cobertura declarada (5); PAP y vínculos a bugs; un `ReconRun`; un lote **importado de verdad** por el trabajador (40 tickets, original conservado) y lotes de fixtures con original sintético; exportaciones con propietario: una **LISTA vigente** (archivo real, SHA-256 registrado), una **CADUCADA** (sin archivo) y la cola pendiente (un `ExportJob` `QUEUED` y un lote `QUEUED` con `UploadJob` `PENDING`). El contenido de las filas de volumen es determinista (`k % …`; los identificadores internos son UUID aleatorios); las cuentas usan contraseñas al azar que no se imprimen.

### Resultado: **89 comprobaciones correctas, 0 fallos** (en ambos volúmenes)

| Paso | Comprobación | Resultado |
| --- | --- | --- |
| 1 | Con la instalación **en marcha**, `backup:crear` rechaza (web y trabajador vivos), no crea copia, no fuerza nada y no imprime credenciales | OK |
| 2 | Parada controlada (trabajador `SIGTERM` ⇒ código 0 y `STOPPED`; luego la web) y cola pendiente creada con el trabajador parado | OK |
| 3 | Referencia HTTP real (origen compilado): 28 recursos —Comparativa (2 vistas + 2 CSV), Análisis Cliente (5 vistas + 4 CSV de ficha), Pulse Rent (2 vistas, detalle, 3 CSV), Calidad (cartera, Client Health, CSV), Cargas/cobertura declarada, Conciliación (página, informe, manifiesto) y estado de las dos exportaciones— todos 200 y con datos; descarga de la exportación lista con SHA-256 igual al registrado | OK |
| 4 | `backup:crear` por la CLI: copia publicada; la copia no contiene credenciales ni `.env`; `backup:verificar`: todo OK | OK |
| 5 | `backup:restaurar --nuevo-origen`: restauración correcta; informe sin ningún FALLO (migraciones, recuentos, identidades, contenido, relaciones, disparadores, ConfigRevision inmutables, archivos, base↔archivos) | OK |
| 6 | **Restaurado = origen en las 63 tablas** (recuento, suma de identidades y suma de contenido), salvo lo que `--nuevo-origen` cambia a propósito (`InstallationMeta` y `Session`); archivos con los mismos nombres y SHA-256 (sin temporales, sondas ni caducadas); lotes por estado iguales; `ConfigRevision` y su disparador presentes | OK |
| 7 | `--nuevo-origen`: `installationId` nuevo ≠ origen, marcas de ambos almacenes reescritas, 1 sesión eliminada (0 restantes) y constancia en el informe | OK |
| 8 | Web compilada restaurada (otro puerto, secreto propio): alta de una **cuenta de prueba nueva**, login por HTTP real y primera vista 200; la **cookie de sesión del origen no vale** (redirige a `/login`; la API analítica la rechaza) | OK |
| 9 | **Paridad** con la referencia: 26 recursos con la cuenta nueva y 28 con la cuenta del origen (propietaria): **0 diferencias** en texto visible, enlaces y CSV/JSON, **incluida la «Referencia de datos» (sello)** | OK |
| 10 | Exportación restaurada vigente: descarga **como propietario**, HTTP 200, SHA-256 = registrado = descarga del origen (5 206 064 B en la referencia; 51 967 978 B en el tamaño medio); la **caducada sigue caducada** (sin archivo, descarga rechazada) | OK |
| 11 | Trabajador compilado restaurado **arrancado deliberadamente** (modo operativo; los almacenes llevan la identidad nueva): completa el `ExportJob` en cola (1 intento, 2 archivos con SHA-256 correcto) y **prepara una sola vez** el lote pendiente (un `UploadJob` `DONE`, 25 filas, lote `READY`, **nada publicado**: 0 filas importadas, mismos `ZdTicket`); sin duplicados (mismo número de `ExportJob`, ningún par trabajo/archivo/parte repetido), sin parciales en `tmp/` y todos los archivos del almacén referenciados; parada ordenada (`STOPPED`) | OK |
| 12 | **Fuente intacta**: mismos recuentos, identidades y contenido por tabla, y mismos archivos y SHA-256 en ambos almacenes que antes de la copia | OK |

Normalización de la comparación HTTP (única): se ignoran las marcas temporales (fecha-hora) y el panel «Sus exportaciones recientes», que es la lista propia de cada persona (el estado y la descarga de las exportaciones se comprobaron aparte, como propietario). El resto —incluido el sello de datos— se compara tal cual.

### Cifras

| | Referencia (≈ 58 mil filas) | Tamaño medio (≈ 574 mil filas) |
| --- | --- | --- |
| Filas en la base (63 tablas) | 58 285 | 573 740 |
| Base de datos (`pg_database_size`) | 54,9 MB | 323,2 MB |
| Originales (17 archivos) / exportaciones (3 archivos) | 0,2 MB / 5,2 MB | 0,2 MB / 52,0 MB |
| **Copia en disco** (volcado + archivos + manifiesto) | **8,5 MB** (volcado 3,0 MB) | **79,9 MB** (volcado 27,7 MB) |
| Espacio estimado necesario por la herramienta | 130,4 MB | 461,2 MB |
| Manifiesto SHA-256 | `2b5ac4bd…2d5d` | `9df529a5…d686` |
| **`backup:crear`** (CLI extremo a extremo, incluye arranque de `tsx`) | **2,7 s** (fases: controles 0,6 · pg_dump 0,6 · archivos 0,1 · verificación interna 0,2) | **9,2 s** (controles 2,3 · pg_dump 4,3 · archivos 0,5 · verificación 0,7) |
| **`backup:verificar`** (CLI) | **0,9 s** | **1,3 s** |
| **`backup:restaurar`** (CLI) | **3,5 s** (pg_restore 1,4 · comprobación de la base 0,6 · archivos 0,1) | **13,2 s** (pg_restore 8,3 · comprobación 2,3 · archivos 0,7) |
| Puesta operativa (arranque de la web restaurada → login → primera vista) | 2,6 s | 4,7 s |
| Trabajador restaurado: cola pendiente retomada y terminada | 2,4 s | 10,2 s |
| Parada controlada (trabajador / web) | < 0,1 s / < 0,1 s (en reposo) | < 0,1 s / < 0,1 s (en reposo) |
| **Indisponibilidad total medida** (parada + crear + verificar + restaurar + puesta operativa) | ≈ 10 s | ≈ 29 s |

Son medidas de **esta máquina compartida con volúmenes sintéticos pequeños y medios**; no son una previsión para producción ni un RTO. Con un trabajo en curso, la parada ordenada puede tardar hasta `CSAPP_WORKER_STOP_TIMEOUT_MS` (120 s) y no se midió aquí. Memoria: las copias y la verificación van por flujos de archivo (sin cargar ficheros enteros); no se midió el pico de RSS de las herramientas.

## Hallazgos durante el trabajo (para quien mantiene el resto)

1. **Las cuatro rutas de CSV analíticos no están versionadas.** `.gitignore` contiene `*.csv` y excluye `src/app/api/analitica/{comparativa,ficha,pulse,calidad}.csv/route.ts`: existen solo como archivos ignorados en el checkout principal y **no están en la rama** (un clon limpio compila sin ellas y los enlaces «Descargar CSV» de las cuatro vistas darían 404). Para el ensayo se copiaron (ignoradas, sin confirmar) desde el checkout principal. Corrección propuesta (fuera de mi zona): excepción en `.gitignore` (`!src/app/api/analitica/**`) y `git add -f` de esos cuatro archivos.
2. `next build --webpack` falla en la comprobación de tipos por `export { first }` en `src/app/(app)/comparativa/page.tsx` (un `page` solo puede exportar símbolos de Next); `npm run build` por defecto (Turbopack) no lo detecta. Observación; no se tocó.
3. El guard de arranque del trabajador/web **funcionó en un caso real**: al heredar `TEST_DATABASE_URL`/`SHADOW_DATABASE_URL` del `.env` del directorio de trabajo rechazó el arranque operativo (`OPCION_DE_PRUEBA`). El ensayo las fija vacías en sus procesos hijos. Un `.env` de instalación real no debe contenerlas.
4. `next build` con `node_modules` como **enlace simbólico** a otro directorio falla con Turbopack (la raíz de resolución queda fuera del proyecto): en el worktree se usó una copia real de `node_modules`.
5. El **sello de datos** cuenta los lotes y varias vistas muestran listas propias de cada persona. Las primeras pasadas del ensayo (46 comprobaciones fallidas) no eran un defecto de la restauración sino del **orden y del criterio del ensayo**: la referencia se capturó antes de crear el lote pendiente (cambia la «Referencia de datos», como debe), se comparó el panel «Sus exportaciones recientes» de otra persona y se pidió a una cuenta no propietaria el estado de exportaciones ajenas. Se corrigió el ensayo (referencia con la cola ya creada; panel propio excluido y estado de exportaciones comprobado como propietario), **no la aplicación**; el sello sí se compara.
6. `AuditEvent` exige una persona autora y no hay actor de sistema: la restauración deja constancia en su informe JSON (`--informe`), no en la auditoría.

## No ejecutado / límites de lo comprobado

- **Windows y PowerShell**: no se ejecutó nada allí. Las rutas con espacios se probaron en Linux (carpetas con espacios, argumentos sin interpolación); las rutas absolutas de Windows solo se comprueban como **rechazo** en el inventario. Los ejemplos de PowerShell de la guía son **no ensayados**.
- **Lector de pantalla** y revisión visual de las vistas: no aplica a estas herramientas y no se hizo.
- **`kill -9` real durante una copia** y **disco lleno real**: simulados (directorio `.tmp-` abandonado creado a mano, fallo de `pg_dump` con un ejecutable doble, corte por excepción `ENOSPC`, espacio libre simulado). No se llenó ningún disco ni se mató la herramienta a mitad de `pg_dump`.
- **Versiones distintas de `pg_dump`/servidor**: solo con ejecutables dobles (versión 12 frente a un servidor 16); no hay otro PostgreSQL instalado.
- **PostgreSQL remoto/gestionado**, restauración entre máquinas, copia con la web en producción real, volúmenes de producción, concurrencia de varios operadores y rendimiento bajo carga: no ensayados.
- **Aceptación de IT/Dennis**: ninguna; frecuencia, custodia, acceso y retención siguen como opciones en la guía.
- La suite completa de la rama (`npm test`, `npm run e2e`) no se repitió: no se modificó código existente salvo `package.json` (cuatro scripts).

## Reproducción

```text
npm run e2e:build
npx vitest run tests/csapp10-backup-crear.test.ts tests/csapp10-backup-verificar.test.ts tests/csapp10-backup-cli.test.ts tests/csapp10-restauracion-completa.test.ts tests/csapp10-restauracion-rechazos.test.ts
npm run ensayo:restauracion -- --salida resultado.json            # referencia
npm run ensayo:restauracion -- --filas 300000 --salida medio.json  # tamaño medio
```

Requisitos: `TEST_DATABASE_URL` apuntando a `cs_app_bkorigen_test` (el ensayo rechaza cualquier otra), usuario con `CREATEDB`, `pg_dump`/`pg_restore` 16 en el `PATH` (o `CSAPP_PG_BIN`), `npm run e2e:build` hecho, y los puertos 3211/3212 libres (`ENSAYO_PORT_ORIGEN`/`ENSAYO_PORT_RESTAURADO`).
