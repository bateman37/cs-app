# HOTFIX-02: validación de Calidad (Resumen de clientes y seis KPI)

Contrato dueño: [calidad](../producto/calidad.md) QLT 20–28. Todo lo de abajo es **lo realmente ejecutado en Linux con datos sintéticos** en la base aislada `cs_app_hf02d_test` (PostgreSQL real). No hay aceptación de Dennis, ni ejecución en Windows, ni datos operativos reales.

## Ejecutado

| Comprobación | Resultado |
| --- | --- |
| `npx tsc --noEmit` y `npx eslint .` | sin errores |
| Suites `calidad-*` (dominio, config, servicio, detalle, `calidad-hotfix02`), `csapp09-*` (aceptación, conciliación, consistencia, evolución, exportaciones, recuperación, sello) y `csapp10-evolucion-paridad` | 13 archivos, 159 pruebas en verde (antes de los últimos retoques); tras ellos se repitieron `calidad-hotfix02` y `calidad-servicio` (43 en verde). No se ejecutó `csapp09-exportacion-trabajador` (necesita trabajador) |
| Compilación | `next build --webpack` y `build-worker` correctos. Turbopack no pudo compilar en el worktree porque `node_modules` es un enlace simbólico fuera de la raíz: es una limitación del entorno de trabajo, no del código |
| Recorrido de navegador `E2E_SOLO=calidad` (`scripts/e2e/casos/14-calidad.ts`, `next start` en el puerto 3203) | 72 comprobaciones, 72 PASS |

Pruebas nuevas (`tests/calidad-hotfix02.test.ts`, 19): parámetros retirados ignorados y listados; dirección canónica estable; segmentadores OR/AND en el mismo Cliente (Grupo, Cliente, herencia del Grupo, sin dato); el filtro no altera valores ni referencias; CSV = pantalla; ni ausencia ni falta de calibración dan verde; null / parcial / cero confirmado distintos; Health sin dato redistribuye a cinco al 20 % y un técnico sin dato conserva su peso; apartados conciliados con el resumen (N3 únicos, PAP único con varias causas y Petición cliente aparte, bugs sin duplicar y solo Bug_); tasas solo con usuarios informados; matriz de Health por selección/objeto y edición solo del Administrador; enlaces de accesos, cabeceras y celdas (HTML renderizado) con `kpi`, `sel` y contexto.

## Revisión visual (datos sintéticos, 1920×1080, 1536×864 y 390 px)

Datos: 18 Grupos con 1–3 Clientes, nombres largos (hasta 80 caracteres), usuarios hasta 4.200, mezcla de soportes y servidor, Health informado y sin informar, Grupos sin usuarios (KPI sin dato), nivel Cliente sin umbrales y un error real (`rcalidad` inexistente). Capturas miradas una a una; evidencia en [`hotfix-02-calidad/`](hotfix-02-calidad/) (sin nombres reales). Medidas de `getBoundingClientRect`, resumen:

| Viewport | Ancho `main` | Scroll horizontal documento | Scroll interno de la tabla | Fuente | Filas | Seis accesos |
| --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 1920 | 0 | 0 | 12 px | 28 px (41 px solo con nombre de dos líneas) | una fila |
| 1536×864 | 1536 | 0 | 0 en el resumen; 64 px en el apartado PAP (tabla de 11 columnas, desplazable en su región) | 12 px | 28 px (hasta 58 con nombres largos en tres líneas) | una fila |
| 390 | — | 0 (tras corregir 13 px de desbordamiento detectados) | dentro de su región | — | — | rejilla de 2 |

En el nivel Cliente las filas con Grupo padre miden 38–53 px (nombre y Grupo en dos líneas): queda por encima de 26–30 px y es una desviación conocida. El resumen a 1920 empieza en y≈199 px y las 18 filas quedan en la primera pantalla.

Correcciones hechas por la revisión: acceso de Dedicación que decía «Sin calibrar» con parte de la selección en verde (ahora «Datos incompletos»), desbordamiento a 390 px, chip de «Último mes cerrado», conflicto de reglas `.ql-*` con `globals.css` (las de Calidad van calificadas con `.ql-page`).

## Fuera de alcance o pendiente

- La reconexión de la cobertura de Calidad con el contrato de carga amplia (§10) es del agente A (`src/server/quality/coverage*`): no se tocó. Hasta entonces, sin declaración se muestran las magnitudes observadas, pero un cero no se afirma.
- «Datos pendientes» enlaza a `/administracion/conciliacion` (la sección «Diagnóstico de datos» la aporta el agente B); no se verificó el ancla `#diagnostico` desde Calidad.
- El enlace de Análisis Cliente a Calidad sigue usando `vista=` (se traduce al apartado equivalente) y llega sin el contexto de periodo/entidad; lo corrige el dueño de esa vista.
- No se midió volumen (250.000 tiempos / 114.000 tickets) ni N+1 de los apartados: usan una consulta por familia de hechos y por año, sin repetirla por mes o entidad, pero sin cifra medida.
- El stock de bugs VFS/VSW es contexto global de producto, no atribuido a clientes.
- El `ExportPanel` («Exportar detalle completo») se conserva plegado al pie del resumen.
