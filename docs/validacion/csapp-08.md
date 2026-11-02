# Validación de CSAPP-08: Calidad, Client Health, diagnóstico y backlog observado

Registro de lo **ejecutado** en Linux (Node 22.22, PostgreSQL 16, Chromium de Playwright 1.63). **No hay pruebas en Windows/PowerShell, no hay aceptación de Dennis, no se ha cargado ningún dato real y no se ha usado `cs_app`**: todo es sintético y en bases `_test` aisladas (guard central de CSAPP-07 intacto). No se han ejecutado cargas reales ni financieros 2025/2026 y no se han limpiado las dos cuentas residuales del incidente de CSAPP-06. Las 475 pruebas / 291 comprobaciones de CSAPP-07 son su informe, no resultados de 08.

## Base Git comprobada (02/11/2026)

| Referencia | SHA | Estado |
| --- | --- | --- |
| `main` | `f71b5b7283ab1081802cc6256899a02f70460a74` | Incluye CSAPP-05, no 06/07 |
| Cabeza de la PR 8 | `bd358cac60eaf205270d88955dabcee920e3e733` | CSAPP-07; PR 8 integrada **en la rama de la PR 7** |
| Cabeza de la PR 7 (`claude/new-session-omvsmd`) | `e0f17e4c8e1a47ad08d10b8eeaf2e5f407c66bb5` | Merge de la PR 8; contiene 06 y 07; mismo contenido que la cabeza de la PR 8 |
| Rama de CSAPP-08 | `feature/CSAPP-08-calidad-client-health` | Creada desde `e0f17e4`; PR apilada contra la rama de la PR 7 |

## Resultados

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run e2e:build` | Correctos (`prisma generate` + `tsc --noEmit` sin errores; ESLint sin errores, queda la advertencia heredada de `09-zendesk.ts`; build de Next y del trabajador correctos) |
| `npm test` | **37 archivos, 529 pruebas correctas** (nuevas de 08: 21 de dominio, 24 de servicio, 7 de detalle, 2 de migración; el resto son las de 06/07 con los ajustes declarados abajo). No se han repetido las pruebas largas (`npm run test:largo`: trabajador de 300 000 filas y volúmenes de importación) porque no se tocó ningún importador ni el trabajador |
| Recorrido de navegador (`npm run e2e`) | **318 comprobaciones correctas, 0 fallos** (291 heredadas de CSAPP-07 + 27 nuevas de Calidad en `14-calidad.ts`; la vista Calidad deja de ser «pendiente» en `02-acceso.ts`) |
| Migración | Base limpia (siete migraciones) y actualización desde CSAPP-07 con datos sintéticos y una `ConfigRevision` v1 conservada intacta (`tests/migracion-csapp08.test.ts`); `prisma migrate diff` generó la migración sin diferencias residuales |
| Regresión de 06/07 | `tests/analitica-*`, `tests/pulse-*`, `tests/calidad-config.test.ts` y migraciones previas dentro de `npm test`; ajustes declarados abajo |

Pruebas nuevas de 08: `tests/calidad-dominio.test.ts` (21: pesos, Health, escala, adaptador v1, composición, ámbitos, diagnóstico), `tests/calidad-servicio.test.ts` (24: cartera sin calibrar, Health, sexto indicador, N3/PAP, backlog y fotografías, cobertura, ámbitos, percentiles, lectura coherente con barrera, sello), `tests/calidad-detalle.test.ts` (7: diagnóstico, backlog con filas, evolución, CSV, notas y permisos), `tests/migracion-csapp08.test.ts` (2) y el caso de navegador `14-calidad.ts` (27 comprobaciones). Los resultados esperados se calculan a mano en las propias pruebas.

## Contraejemplos de §2 (escritos antes de conectar datos)

| Punto | Prueba | Resultado |
| --- | --- | --- |
| Pesos y fuente técnica ausente | `calidad-dominio`: técnico ausente conserva 1/6; Health en blanco + técnico ausente → 20 % ×5 asignado, cobertura 80 % | Corregido |
| Health no confirmado | Categoría con `confirmed=false` → «sin calibrar», sin color ni redistribución | Corregido |
| Escala del backlog | 2 envejecidos / 10 usuarios = 20 por 100; conversión v1 ×100 explícita | Corregido |
| Cobertura | `calidad-servicio`: otro cliente no acredita; sin declaración no hay cero; lote revertido no cuenta | Contrato nuevo; Pulse lo adopta |
| Ámbitos | Regla de Grupo no se aplica a Cliente; implantación no hereda | Corregido |
| Composición | Peor señal: flujo verde + backlog rojo → rojo; sin elegir → sin color | Corregido |

## Ajustes a pruebas heredadas (declarados)

- `migracion*.test.ts` (01→02, 02→03, 04→05, 06→07): ya no fijan el total de migraciones (el recuento exacto pasa a la prueba de 08); se comprueba que las anteriores siguen intactas.
- `pulse-servicio.test.ts` y el caso `13-pulse.ts`: Pulse Rent adopta el contrato de cobertura declarada (CSAPP-08 §6), por lo que sus pruebas declaran la cobertura de las cuatro fuentes; una prueba comprueba además que sin declaración (lote revertido) el cero no se sustenta.
- `02-acceso.ts`: Calidad deja de ser una vista «pendiente»; ahora se comprueba su estado vacío honesto.
- `calidad-config.test.ts` y `pulse-formularios.test.ts`: reglas por ámbito y unidad; percentiles exigen muestra mínima elegida; backlog 100× (cambios intencionados, no regresiones).
- Se corrigió durante la validación un error propio: el percentil de edad (mediana/P90) usaba la escala equivocada y devolvía 0,2 en lugar de 30 (detectado por `calidad-detalle`).
- Se corrigió que la fixture de bugs de las pruebas no creaba la observación del Work Item (Calidad declara «sin fuente de bugs» sin ella).

## Medidas de volumen (`npm run benchmark:calidad`; una ejecución)

Fixture aislada: 1 500 grupos y 1 500 clientes con usuarios propios, 250 000 tiempos, **116 000 tickets** con sus revisiones (114 000 sintéticos + 2 000 de la siembra heredada), seis fotografías mensuales (cinco «solo sin resolver» y una final con todos los estados: **225 508 observaciones**), 6 000 PAP con causas, 3 000 vínculos a bugs con evidencia, 15 000 celdas de Client Health y cobertura declarada; configuración activada (reglas absolutas y por percentiles con referencia «todos»). Siembra ≈36 s.

| Medida | s | Sentencias | KB JSON | RSS Δ / total MB |
| --- | --- | --- | --- | --- |
| Cartera Grupo Cliente (página 1 de 50, referencias por percentiles) | 2,90 | 23 | 376 | 68 / 339 |
| Cartera Cliente (1 500 clientes) | 4,39 | 24 | 360 | 8 / 347 |
| Filtro por color y orden por global (misma cohorte) | 2,53 | 23 | 377 | 40 / 387 |
| Ficha de una entidad (cartera + selección) | 2,54 | 23 | 376 | 6 / 394 |
| Evolución mensual de una entidad | 3,40 | 9 | 2 | 0 / 394 |
| Backlog histórico (cartera, fotografía exacta, página 1) | 3,80 | 9 | 11 | 1 / 394 |
| Backlog de un corte con solo fotografía anterior | 1,04 | 9 | 12 | 0 / 395 |
| Diagnóstico por origen (cartera) | 0,66 | 8 | 3 | 0 / 395 |
| Detalle de una familia (página 1) | 0,57 | 6 | 9 | 0 / 395 |
| Matriz de Client Health (página 1) | 0,03 | 6 | 120 | 0 / 395 |
| CSV completo de la cartera (1,4 MB) | 2,87 | 23 | 1 387 | 18 / 413 |

Las sentencias son constantes (sin consulta por entidad, KPI ni mes; la evolución hace una consulta de stock por mes con fotografía, como mucho doce). Cada petición recalcula la cartera completa sin caché: ≈3-4 s a 1 500 grupos, **mejorable y no un objetivo prometido**. Una primera medida (6,4 s) mejoró al leer solo los tickets activos de la fotografía y al filtrar antes de resolver organización. No se repiten benchmarks financieros ajenos (el motor económico no se modificó). Medidas del propio entorno de pruebas, no extrapolables.

## Revisión visual y accesibilidad

El recorrido comprueba a 1 440 y 390 px (sin desplazamiento horizontal de la página; la tabla se desplaza dentro de su región con foco de teclado), texto de estados (verde/amarillo/rojo siempre con texto y símbolo), tabla equivalente de la evolución y gráfico con leyenda y tooltips. **No se ha probado con lector de pantalla.** Las capturas (opcionales con `E2E_CAPTURAS`) no se versionan.

## Límites y no verificado

- Windows/PowerShell sin probar; sin aceptación de Dennis; sin archivos reales; las pruebas de Dennis (cargas reales, financieros 2025/2026) siguen pendientes.
- La cobertura no se infiere: hasta que el Administrador declare la de cada lote, los valores distintos de cero son «parciales» y los ceros «no sustentados»; con datos reales la primera vista mostrará magnitudes sin colores hasta esa declaración y la calibración. **Pulse Rent ya comparte este contrato**, de modo que sus ceros también esperan la declaración (cambio de comportamiento respecto a CSAPP-07).
- Percentiles de la evolución mensual: la serie usa solo reglas absolutas (no recalcula la referencia de cada mes).
- Implantación: no es ámbito de Calidad (solo horas/PAP atribuibles en la ficha), como exige el contrato.
- No se ha medido el trabajador de cargas ni se han repetido sus pruebas largas: no se tocó ningún importador.
- ECO 08, ZDT 11–13, ZTM 06–08, lista de origen PAP, estados de bugs, signo de «Diferencia» y Silver siguen pendientes y no aceptados.
