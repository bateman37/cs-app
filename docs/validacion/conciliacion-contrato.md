# Contrato de conciliación (CSAPP-09)

Comprobación de conciliación de **Administración › Conciliación** ([`src/server/reconciliation/service.ts`](../../src/server/reconciliation/service.ts)). Estado: implementada y probada en Linux con fixtures sintéticas ([`tests/csapp09-conciliacion.test.ts`](../../tests/csapp09-conciliacion.test.ts)); **la conciliación con los datos reales de Dennis está pendiente de ejecución por él** (ver [validación](csapp-09.md)).

## Qué es y qué no es

- **Solo lee.** No modifica fuentes, no activa configuración ni reprocesa lotes. Reutiliza los servicios de Calidad (`hourFacts`, `ticketFacts`, `papFacts`) y los conjuntos de las exportaciones; no es una quinta calculadora de rentabilidad.
- Se elige periodo (desde/corte), ámbito (Grupo/Cliente), entidad opcional y servicio. Devuelve por comprobación: resultado, esperado, observado, diferencia con su tolerancia, identidades implicadas, exclusiones justificadas, fuentes y notas; y por informe: sello de datos, fecha de lectura y manifiesto (revisiones activas, lotes completados/revertidos, parámetros).
- Cada ejecución se **registra** (`ReconRun`) y **no se reescribe**. Un informe anterior conserva sus resultados y avisa («los datos actuales han cambiado») si el sello actual difiere. Descargas: informe tabular CSV y manifiesto JSON. Solo Administrador.
- Los detalles privados de una base real no se versionan en Git.

## Niveles y IDs estables

| ID | Nivel | Comprobación | Aditiva | Tolerancia |
| --- | --- | --- | --- | --- |
| `REC-N1-01` | 1 Fuente y lote | Minutos Zendesk de la fuente = minutos de la proyección `TimeActivity` (identidades `(source, entryId)` únicas) | Sí | 0 (exacta) |
| `REC-N1-02` | 1 | Ídem Wrike (sus horas decimales ya son minutos: no se divide otra vez por 60) | Sí | 0 |
| `REC-N1-03` | 1 | Lotes completados/revertidos por perfil: recibidas, válidas, error, repetidas, excluidas, importadas (trazabilidad) | No (informativa) | — |
| `REC-N1-04:{año}:{categoría}` | 1 | Finanzas: Σ líneas activas = Total de origen del lote vigente; «Vta Potencial» y Budget separados; no se suma el anual con sus meses | Sí | la **monetaria** capturada por el lote (solo dinero) |
| `REC-N2-01` | 2 Hechos elegibles | Partición de horas: ELEGIBLE + PENDIENTE + EXCLUIDA = total del periodo; exclusiones por motivo (PMO, internos, sin relación…) | Sí | 0 |
| `REC-N2-02` | 2 | Horas elegibles sin Grupo (sin relación) | Informativa | — |
| `REC-N2-03` | 2 | Tickets creados en el periodo: con entidad frente a sin atribución (los tickets sin horas permanecen para Calidad) | Informativa | — |
| `REC-N3-01` | 3 Resultado | Horas elegibles: servicio de Calidad (`hourFacts`) = conjunto de exportación `horas` (ELEGIBLE atribuido), mismo filtro de servicio | Sí | 0 |
| `REC-N3-02` | 3 | Tickets creados: servicio = conjunto `tickets` | Sí | 0 |
| `REC-N3-03` | 3 | Escalados N3 (unión PMO ∪ IT, un ticket una vez) | **No** (PMO/IT son desgloses) | 0 |
| `REC-N3-04` | 3 | Flujo de incidentes y problemas | Sí | 0 |
| `REC-N3-05` | 3 | Sexto indicador: problemas únicos (causa estándar ∪ vínculo válido a `Bug_`) = filas que cuentan de `problemas_bugs` | **No** (relación uno a varios) | 0 |
| `REC-N3-06` | 3 | Unión del conjunto `tickets` (`afectacion_union`) = unión del servicio | Sí | 0 |
| `REC-N3-07` | 3 | PAP correctivos únicos lista+ID (cualquier causa correctiva; sin filtro silencioso `Resultado=OK`) | Sí (el desglose por causa no) | 0 |
| `REC-N3-08` | 3 | Ingreso de las líneas activas: conjunto `finanzas_lineas` = suma directa (sin entidad seleccionada) | Sí | 0 |

Estados: `OK` (coincide dentro de su tolerancia), `DIFERENCIA`, `INFORMATIVO` (no se fuerza coincidencia: perímetros distintos con explicación) y `NO_DISPONIBLE` (falta una fuente: nunca se inventa un resultado). **La tolerancia monetaria no tapa diferencias de horas ni de conteos** (probado).

## Límites declarados

- El nivel 3 concilia el **servicio de Calidad ↔ conjuntos de exportación (detalle/CSV)**. La paridad con la cartera de Comparativa y con Pulse Rent usa los mismos motores (`runEconomics`, `computePulse`) y sus propias pruebas de 06/07; no se ha añadido en 09 un puente automático de Comparativa/Pulse dentro de esta pantalla (**pendiente, propuesto**).
- Las comprobaciones de Usuarios (valores propios de Grupo y Cliente, no suma de hijos) y de rentabilidad ponderada se cubren con las pruebas de 05/06 y los casos de aceptación de [`tests/csapp09-aceptacion.test.ts`](../../tests/csapp09-aceptacion.test.ts); no son un ID `REC-*`.

## Resultado conocido pequeño y reproducible

`tests/csapp09-conciliacion.test.ts`: tiempos 60 + 120 (elegibles), 30 (pendientes), 15 (excluido PMO, sin Grupo) en octubre de 2026; dos problemas (uno con causa estándar y PMO N3 + IT N3, otro con **dos bugs** vinculados), un PAP con dos causas y una línea financiera SOPORTE 2026 de 12 000 €. Esperado: `REC-N1-01` 225 = 225; `REC-N2-01` 225 con exclusión PMO ×1; `REC-N3-01` 180 = 180; `REC-N3-03` 1; `REC-N3-05` 2 = 2; `REC-N3-07` 1 = 1; `REC-N1-04:2026:SOPORTE` 12 000 = 12 000. Con un Total de origen de 12 000,50 → `DIFERENCIA` de −0,5 (tolerancia 0,01); con 12 000,005 → `OK`.
