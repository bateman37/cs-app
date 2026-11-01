# Validación de CSAPP-06: Comparativa y Análisis Cliente

Registro de lo **ejecutado** en Linux (Node 22.22.0, PostgreSQL 16, Chromium de Playwright 1.63). **No hay pruebas en Windows/PowerShell, no hay aceptación de Dennis y no se ha cargado ningún dato real**: todo es sintético y en bases `_test` aisladas. Sin migración nueva. Base: `main` `f71b5b7283ab1081802cc6256899a02f70460a74` (merge de la PR 6 de CSAPP-05; Git muestra su cabeza `c6d5209` incluida: integración, no aceptación).

## Resultados

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run e2e:build` | Correctos (queda la advertencia anterior de `09-zendesk.ts`) |
| `npm test` | **27 archivos, 392 pruebas correctas** (338 de CSAPP-05 + 54 nuevas/ajustadas: 19 de dominio, 14 de motor, 19 de servicios, 2 de limpieza, más ajustes) |
| `tests/cargas-trabajador.test.ts` (300 000 filas, sin reducir volumen ni aserciones) | **3 pruebas correctas en 260 s** con el trabajador real; `afterEach`/`afterAll` limpian solo los hijos propios |
| `tests/cargas-limpieza.test.ts` | Un fallo forzado deja un hijo vivo; la limpieza centralizada lo termina (solo los suyos) y la prueba siguiente continúa |
| Recorrido de navegador (`npm run e2e`) | **238 comprobaciones correctas** (62 nuevas de CSAPP-06) con web y trabajador compilados |
| Volumen (`npm run benchmark:analitica`, 1 500 grupos, 250 000 tiempos) | Ver tabla |

## Defectos corregidos con prueba

TAR RUN (`365/días` → `12R/UM`), comparable de mes completo (28/02 → 29/02/2024), cartera que publicaba `AVAILABLE` con filas parciales, cero horas válido, explicación de desviaciones (componentes reales), `provisional` fijo en las series, derivados pendientes presentados como válidos, y `MAX(drvVersion)` como identificador de estado. **Prueba de lectura consistente** con dos conexiones y barrera: cambia la sustitución financiera, los usuarios y la atribución durante la lectura y la respuesta es toda la anterior; la siguiente, toda la nueva. Mutando el aislamiento a `READ COMMITTED` la prueba falla (comprobado). Corrección del informe de CSAPP-05: allí el mecanismo era una transacción `REPEATABLE READ` **sin prueba concurrente**; ahora está probado para las lecturas analíticas.

## Medidas de volumen (una ejecución, 4 CPU)

| Medida | s | Sentencias | KB JSON | RSS Δ / total MB |
| --- | --- | --- | --- | --- |
| Carga inicial de Comparativa (1ª, en frío) | 5,86 | 22 | 677 | 69 / 252 |
| Filtro (plan Gold) | 1,19 | 22 | 676 | 15 / 267 |
| Orden por €/jornada CUM | 3,07 | 22 | 662 | 58 / 325 |
| Segunda página | 2,75 | 22 | 679 | 47 / 372 |
| Ficha de Grupo (Resumen, cohorte completa) | 3,09 | 37 | 79 | 51 / 423 |
| Ficha (Dedicación, solo el grupo) | 0,30 | 31 | 69 | 0 / 423 |
| Detalle de horas (página 1) | 0,16 | 6 | 9 | 0 / 423 |
| CSV de la cartera completa (6,4 MB) | 3,02 | 22 | 6 449 | 72 / 496 |
| CSV de la ficha (series) | 3,34 | 37 | 22 | −2 / 494 |

Las sentencias no crecen con el nº de grupos (sin N+1). Cada página recalcula la cartera completa (sin caché): 3 s a 1 500 grupos; no es un objetivo prometido y no se midió con 60 000 grupos. La respuesta JSON de la cartera (≈ 0,7 MB por página) es mejorable.

## Revisión visual

Capturas de 1 440 px y 390 px de Comparativa, ficha (resumen y dedicación) y selector, con datos sintéticos (no versionadas). Se comprobó: tabla con cabeceras agrupadas y primera columna fija, desplazamiento contenido (sin desbordamiento horizontal de la página a 390 px, comprobado por el recorrido), tarjetas con cobertura, avisos de cartera incompleta, gráficos con leyenda, marcadores y tablas equivalentes. Defectos visibles aceptados: la etiqueta de unidad del eje se solapa ligeramente con la de enero y un hito puede recortarse en el borde derecho; la alineación de los filtros múltiples es mejorable. Estados vacíos (base vacía, sin coincidencias, error con acción) cubiertos en el recorrido.

## Límites

Windows sin probar; aceptación de Dennis pendiente; sin archivos reales; ECO 08 y las propuestas pendientes siguen sin aceptar; sin Pulse Rent, Calidad, Client Health ni semáforos; descarga masiva de hechos brutos y tareas de fondo en CSAPP-09. **Incidente de proceso:** una importación estática en el recorrido hizo que una ejecución intermedia abriera la base de desarrollo `cs_app` del contenedor (vacía, sin datos de Dennis): `prepareDatabase` la vació y creó en ella dos cuentas sintéticas (`*.e2e@test.local`). Se corrigió con importación diferida; la limpieza de esas dos cuentas la bloqueó el sistema de permisos y queda pendiente de decisión.
