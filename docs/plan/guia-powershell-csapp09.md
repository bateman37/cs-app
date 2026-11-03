# Guía PowerShell de CSAPP-09 (escrita, **sin probar en Windows**)

> **Guía histórica (CSAPP-09).** Describe el arranque de esa entrega y puede contradecir la operación actual. La guía **vigente** de instalación, arranque y operación es [instalación y operación](../operacion/instalacion-operacion.md); los comandos de aquí no se usan en una instalación operativa.

Hay **una migración nueva**: `20261104090000_exportaciones_conciliacion` (tablas `ExportJob`, `ExportFile`, `ExportRow` y `ReconRun`; no toca ninguna tabla anterior, las `ConfigRevision` ni los datos de CSAPP-08). Los dos índices heredados de 08 que faltaban en `schema.prisma` quedan declarados (sin cambio en la base). Todos los comandos funcionan con Node; **no se necesita Bash**. Todo lo de abajo se ha ejercitado en Linux; Windows y PowerShell **no se han probado**.

```powershell
git fetch origin
git checkout feature/CSAPP-09-conciliacion-exportaciones-rendimiento
npm ci
npm run db:migrar
npm run build
npm start
```

## Dos procesos: web y trabajador

Las exportaciones grandes **no se generan dentro de la petición web**: las ejecuta el trabajador, el mismo proceso que las cargas (ahora con dos bucles independientes: una exportación grande no bloquea las cargas ni al revés). Sin trabajador una exportación queda «en cola» y la pantalla lo avisa.

```powershell
# Terminal 1 (web)
npm start
# Terminal 2 (trabajador de cargas y exportaciones)
npm run worker
# Ctrl+C lo detiene de forma ordenada; si cae, al reiniciarlo retoma lo pendiente
```

Almacén de exportaciones: **privado y separado de los originales** (`almacen-exportaciones/` junto a la aplicación, o `CSAPP_EXPORT_DIR`). No está en `public/` ni en Git.

```powershell
$env:CSAPP_EXPORT_DIR = "D:\datos\cs-app\exportaciones"   # opcional; distinto de CSAPP_UPLOAD_DIR
$env:CSAPP_EXPORT_TTL_HOURS = "24"                         # vida útil de un artefacto terminado
$env:CSAPP_EXPORT_MAX_ACTIVE_PER_USER = "2"                # exportaciones simultáneas por persona
$env:CSAPP_EXPORT_PART_ROWS = "1000000"                    # filas de datos por archivo (límite de Excel: 1 048 575)
```

## Pruebas: la base debe ser explícita, aislada y distinta de la tuya

Igual que en 07/08: las pruebas que modifican datos se niegan a ejecutarse si `TEST_DATABASE_URL` falta, no acaba en `_test`, coincide con la base de trabajo o la conexión efectiva no es esa base. **No pruebes con `cs_app`.**

```powershell
$env:TEST_DATABASE_URL = "postgresql://USUARIO:CLAVE@localhost:5432/cs_app_test?schema=public"
npm run typecheck
npm run lint
npm test                     # rápida: contratos numéricos, conciliación, exportaciones, sello, migraciones y regresión de 06–08
npm run test:largo           # trabajador real con SIGKILL, volúmenes (lentas; ver tiempos en la validación)
npm run e2e:build
npm run e2e                  # recorrido de navegador (incluye exportación, conciliación y permisos)
npm run benchmark:calidad    # 1500 grupos, 250 000 tiempos, 114 000 tickets y seis fotografías; también mide conciliación y exportación; solo base _test
```

Variables de la prueba del trabajador real (opcionales): `CSAPP_TEST_EXPORT_ROWS` (por defecto 300 000; la validación usó 250 000 y 1 000 000).

## Recorrido breve para Dennis (con tus archivos reales, por tu cuenta)

1. **Cargar y repetir** un lote (tiempos o tickets): la segunda carga idéntica no duplica; el resumen lo muestra.
2. **Sustituir un año/categoría** (por ejemplo SOPORTE 2026) con una fila cambiada y otra ausente: el lote nuevo sustituye el anterior completo; otras categorías/años no cambian. Revierte tu lote de prueba y comprueba que se restaura el conjunto anterior.
3. **Declarar cobertura** de tus lotes (Administración › Cargas) para que un cero sea cero sustentado.
4. **Administración › Conciliación**: elige periodo y ámbito y pulsa «Ejecutar comprobación». Revisa los tres niveles (fuente y lote, hechos elegibles, resultado). Descarga el informe CSV y el manifiesto. Si cargas más datos después, el informe avisa de que los datos han cambiado, sin reescribirse.
5. **Comprobar un cliente y su grupo en las cuatro vistas** (Comparativa, Análisis Cliente, Pulse Rent, Calidad): mismas horas, tickets, PAP y bugs; revisa la **evolución mensual** de Calidad (seis indicadores por mes, con la revisión usada).
6. **Revisar un ticket antiguo** abierto en «Backlog por antigüedad».
7. **Exportar detalle completo** desde cualquier vista: elige el conjunto, observa el progreso, sal de la pantalla y vuelve, descarga el CSV y el manifiesto y comprueba recuentos y totales con la conciliación. Prueba «Cancelar» y «Reintentar».
8. **Con y sin permiso**: con una cuenta de Consulta exporta el detalle que puede leer; comprueba que no ve ni puede descargar exportaciones ajenas y que no accede a Cargas.

Las **calibraciones** (umbrales, referencias, mínimos de muestra, mapeo de Health, composición del global) se pedirán solo cuando llegues a ellas. La conciliación con **tus** datos reales está **pendiente de ejecución por ti**; lo ejercitado hasta ahora son fixtures **sintéticas** y no equivale a ella.
