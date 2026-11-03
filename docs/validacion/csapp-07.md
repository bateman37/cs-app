# Validación de CSAPP-07: Pulse Rent, configuración y prevención de pruebas sobre la base equivocada

Registro de lo **ejecutado** en Linux (Node 22, PostgreSQL 16, Chromium de Playwright 1.63, 4 CPU). **No hay pruebas en Windows/PowerShell, no hay aceptación de Dennis y no se ha cargado ningún dato real**: todo es sintético y en bases `_test` aisladas. Migración nueva: `20261102090000_pulse_calidad_configuracion`. Base: cabeza de la PR 7 (CSAPP-06, `8c92ab8`, **sin fusionar**); `main` (`f71b5b7`) no la incluye. Los 392 tests / 238 comprobaciones de CSAPP-06 son su registro, no los resultados de aquí.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run e2e:build` | Correctos (queda la advertencia heredada de `09-zendesk.ts`) |
| `npm test` | **33 archivos, 475 pruebas correctas** (nuevas: guard 13, dominio de Pulse 19, servicio de Pulse 17, Calidad y configuración 28, formularios 4, migración 2; ajustes de recuento en tres migraciones previas) |
| `tests/cargas-trabajador.test.ts` (300 000 filas) | 3 pruebas correctas en 270 s |
| Recorrido de navegador (`npm run e2e`) | **291 comprobaciones correctas** (53 nuevas de CSAPP-07: `13-pulse.ts`; la vista Pulse Rent deja de ser «pendiente» y pasa a estado vacío) |
| Migración | Base limpia (seis migraciones) y actualización desde CSAPP-06 con datos sintéticos conservados (`tests/migracion-csapp07.test.ts`); `prisma migrate diff` sin diferencias |

Casos **definidos** frente a **ejecutados**: todos los de la tabla de §12 del prompt tienen prueba ejecutada salvo los límites siguientes.

## Prevención de la base equivocada (§3)

Probada con dobles controlados (`tests/guard-pruebas.test.ts`): variable ausente, URL no postgres, nombre sin `_test`, nombre solo en contraseña o query, parámetros que redirigen, misma base que la de trabajo, cliente ya conectado a otra base (importación anticipada), URL válida con cliente conectado a otra base (no se emite ninguna mutación, `fn` no se ejecuta) y recorrido válido sobre la base `_test`. Ningún caso negativo ejecuta una operación destructiva sobre `cs_app`. El cliente `prisma` ya no se abre al importar el módulo. Esto **previene**; no declara resuelto el incidente.

**Residuos del incidente de CSAPP-06 — pendientes de decisión de Dennis.** La base `cs_app` del contenedor conserva 2 cuentas sintéticas creadas por aquella ejecución (comprobado solo por lectura). No se han borrado, vaciado ni reintentado su limpieza por otro canal.

## Medidas de volumen (`npm run benchmark:pulse`, 1 500 grupos, 250 000 tiempos, 4 500 PAP, destinos N2/N3 sintéticos; una ejecución)

| Medida | s | Sentencias | KB JSON | RSS Δ / total MB |
| --- | --- | --- | --- | --- |
| Tabla inicial (20 métricas, referencia «todos», página 1) | 9,21 | 29 | 431 | 40 / 273 |
| Cambio de referencia (sin Silver) | 5,84 | 29 | 431 | 61 / 334 |
| Cambio de normalización (bruto) | 5,41 | 29 | 407 | 60 / 394 |
| Orden por M01 y segunda página | 5,83 | 29 | 419 | 68 / 462 |
| Distribución de una columna | 5,78 | 29 | 431 | 62 / 524 |
| Ámbito Cliente (1 500 clientes) | 4,63 | 29 | 471 | −10 / 514 |
| Detalle de horas N1 (página 1) | 0,19 | 9 | 5 | 0 / 514 |
| Detalle de PAP estándar (página 1) | 0,07 | 9 | 2 | 0 / 514 |
| CSV completo de filas filtradas (3,5 MB) | 5,66 | 29 | 3 552 | 11 / 525 |
| CSV de estadísticas | 5,52 | 29 | 8 | −8 / 517 |

Las sentencias son constantes (sin consultas por celda, cliente ni percentil). Cada petición recalcula la referencia completa sin caché: 5-9 s a 1 500 grupos, **mejorable y no un objetivo prometido**; el motor económico de 06 pesa ≈3 s de ese tiempo. La siembra tarda 21 s. No se repitió el benchmark financiero ajeno (el motor no cambió salvo ámbitos `clients`/`implementations`).

## Revisión visual

Capturas (no versionadas) a 1 440 y 390 px de Pulse Rent, detalle, Configuración Pulse y Calidad. Corregido durante la revisión: desbordamiento horizontal a 390 px por las listas de definición (`.kv`) y minutos del detalle con 20 decimales. Comprobado por el recorrido: sin desplazamiento horizontal de la página a 390 px, texto en todas las bandas, tabla alternativa del gráfico de distribución, foco de teclado en controles reales. **No** se probó con lector de pantalla.

## Límites

Windows sin probar; sin aceptación de Dennis; sin archivos reales; ECO 08, ZDT 11-13, ZTM 06-08, lista de origen PAP, estados de bugs, signo de «Diferencia» y Silver siguen pendientes. Umbrales numéricos, mínimos de muestra y composición del global de Calidad **sin calibrar**; la composición «peor señal», el mapeo de Client Health y la plantilla del global son **propuestas desactivadas** (solo se activan por elección del Administrador); los pesos iguales son lo único confirmado. M11 (PAP evolutivos no facturables) no disponible sin evidencia de facturación. Implantación como ámbito solo tiene horas y PAP atribuidos (no tickets). La equivalencia histórica «total − incidente» no se ofrece. Los gráficos de CSAPP-06 no se reutilizaron, por lo que sus defectos de ejes/hitos no se tocaron. Sin dashboard de Calidad, Client Health real ni global real por cliente (CSAPP-08).
