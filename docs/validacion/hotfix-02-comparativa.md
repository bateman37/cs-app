# HOTFIX-02 · Validación de Comparativa y ancho panorámico (agente B)

Alcance: ancho real de las tres vistas rediseñadas, Comparativa completa (§7), filtros Soporte y Servidor en la capa de cartera, retirada de la información técnica hacia «Diagnóstico de datos». Contrato dueño: [Comparativa](../producto/comparativa.md). Todo lo de abajo se ejecutó en Linux, con PostgreSQL real, base propia `cs_app_hf02b_test` y datos **sintéticos**; nada se ejecutó con datos reales de Dennis ni en Windows. Esto no es una aceptación de Dennis.

## Qué se cambió

| Pieza | Archivos |
| --- | --- |
| Ancho del padre `main` por ruta | `src/components/main-shell.tsx`, `src/app/(app)/layout.tsx`, `src/app/globals.css` (`main.main-wide`) |
| Consulta de la vista normal (solo `fecha`, `modo`, `soporte`, `servidor`, `orden`, `dir`, `pagina`) | `src/domain/comparativa-query.ts` |
| Filtros Soporte/Servidor con AND en el mismo Cliente, «Mixto», totales de usuarios/tarifa | `src/server/analytics/portfolio.ts` (`GroupMeta.units`, `matchesCommon`, `usersTariffTotal`, `PortfolioView.totals`), `src/domain/analytics-query.ts` (`servidor` sustituye a `alojamiento` como clave) |
| Tabla, barra de periodo, cabecera, error | `src/app/(app)/comparativa/{page,table,period-bar}.tsx` (se elimina `filters.tsx`) |
| CSV = pantalla | `src/server/analytics/export.ts`, `src/app/api/analitica/comparativa.csv/route.ts` |
| Diagnóstico de datos | `src/app/(app)/administracion/conciliacion/{page,diagnostico}.tsx` |
| Pruebas | `tests/hotfix02-comparativa.test.ts`, `scripts/e2e/casos/12-analitica.ts` (bloque Comparativa), `scripts/e2e/casos/visual-comparativa.ts` + `scripts/e2e/visual.ts` |

## Pruebas ejecutadas

- `npx tsc --noEmit` y `npx eslint .`: sin errores.
- Vitest (PostgreSQL real, `cs_app_hf02b_test`): `analitica-servicios`, `analitica-dominio`, `analitica-motor`, `hotfix02-comparativa`, `csapp09-exportaciones`, `csapp09-conciliacion`, `csapp09-consistencia`, `csapp09-sello`, `csapp09-aceptacion`, `csapp10-puente`, `calidad-servicio`, `pulse-servicio`: 12 archivos, 137 pruebas, todas en verde. No se ejecutó `npm test` completo.
- `tests/hotfix02-comparativa.test.ts` (8 pruebas): limpieza de URL (las 12 claves antiguas se ignoran y no se reescriben); AND en el mismo Cliente (Alfa tiene Gold en un Cliente y CLOUD en otro: Gold+CLOUD no la incluye; Gold+OP sí); Grupo incluido conserva ingreso y horas completos; ΣR/ΣH×jornada del filtrado (no la media de ratios) y totales idénticos en la página 1 y 2; usuarios y tarifa agregados con grupos sin dato declarados; CSV con las mismas filas, orden y totales que la pantalla; claves antiguas no recortan el CSV.
- E2E compilado (`npm run e2e:build` + `E2E_SOLO=analitica`, puerto 3201): 55 PASS, 0 FAIL. Incluye geometría a 1920×1080 y 1536×864, doble filtro por clic sin Ctrl, parámetros antiguos no propagados en los enlaces, barra de periodo, «—» con motivo al clic, «Datos pendientes» → Diagnóstico, CSV filtrado y de claves antiguas, y los controles de ficha que ya existían. No se ejecutó el recorrido completo de los 16 casos.

## Revisión visual (imágenes miradas)

Datos sintéticos: 46 Grupos (nombre de 130 caracteres, ingreso anual de 12,3 M€, soportes y servidores mixtos, Grupos sin ingreso/horas/usuarios) y un error real de lectura (tabla de ingresos renombrada en la base de test y restituida). Capturas versionadas (sintéticas): `docs/validacion/hotfix-02-comparativa/`.

| Vista | scrollWidth / clientWidth del contenedor | Documento | Filas | Fuente |
| --- | --- | --- | --- | --- |
| 1920×1080, 100 % | 1878 / 1878 (sin scroll horizontal) | sin desbordamiento (1920/1920) | 27 px | 12 px |
| 1536×864, 100 % | 1838 / 1494 (≈344 px de scroll horizontal dentro del contenedor, con foco de teclado) | sin desbordamiento | 27 px | 12 px |
| 390 px | 1764 / 356 (scroll dentro del contenedor, nombre fijo a 112 px) | sin desbordamiento | 27 px | 12 px |

`main` con `max-width: none` y ancho completo en los tres. Sin solapes entre celdas, sin filas de dos líneas. Con cifras muy grandes la medición automática marcó una celda cuyo texto roza el límite; a la vista todos los importes se leen completos. El nombre se abrevia con «…» y se conserva completo en el enlace (`title`) y en el DOM.

Corregido durante la revisión: la primera tabla medía 2590 px (anchos por contenido) y las columnas Soporte/Servidor se pisaban; se pasó a `table-layout: fixed` con anchos por columna. Los chips activos usaban el amarillo de marca con texto blanco (poco contraste): pasan a azul. El mensaje de error mostraba el texto crudo de Prisma: ahora es comprensible y el detalle queda solo para Admin.

## Decisiones y límites

- «A fecha de hoy» en un mes ya cerrado equivale al fin de ese mes; «Mes completo» fija el modo `FULL_MONTH`.
- Total «Desv. media filtrada»: «—» con explicación (el total es su propia referencia). Cuando la cartera no es completa, los totales de €/jornada y desv. objetivo se muestran con `*` sobre el conjunto sin los Grupos afectados (lo que ya publica el motor), nunca como cartera completa.
- Las desviaciones por fila contra la media filtrada siguen siendo `—` si la cartera del filtrado no es completa (comportamiento del motor compartido, sin tocar).
- Se quitó de Comparativa el panel de exportación de hechos brutos (`ExportPanel`); sigue en Administración › Exportaciones. Se conserva el CSV de la cartera.
- `servidor` pasa a ser la clave de URL del filtro de alojamiento en `queryToParams`/`parseAnalysisQuery` (se sigue leyendo `alojamiento` como alias heredado). Quien abra Análisis Cliente o Calidad con el contrato compartido debe añadir `servidor` a su lista de claves de retorno (`BACK_KEYS` en `analisis-cliente/links.ts`).
- En una base de test vaciada, la primera apertura concurrente de pantallas puede chocar al crear la revisión 1 de la configuración económica (`40001`); las instalaciones reales la reciben de la migración. Los casos visuales y de analítica la reponen antes de abrir pantallas.

## No ejecutado

Volumen (≈250.000 tiempos y 114.000 tickets), maestro real `CLIENTES.xlsx`, datos operativos reales de Dennis, Windows, el recorrido E2E completo y `npm test` completo. Pulse Rent no se tocó.
