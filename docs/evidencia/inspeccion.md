# Inspección de los ficheros aportados

> Registro histórico. En reglas modificadas prevalecen DEC-003 y los contratos temáticos v0.4. Los formatos antiguos de tickets y la propuesta pendiente del sexto indicador están sustituidos. No usar esta evidencia como perfil vigente.

## Alcance realizado

Se ha abierto el libro cifrado con acceso autorizado por el usuario, sin ejecutar VBA ni modificar el original. Se han inspeccionado las veinte hojas, fórmulas representativas y sus precedentes, tablas, formatos condicionales y seis gráficos. Se han recorrido los registros de los exports para perfilar estructura, duplicados y relaciones. Los valores en caché del XLSM se trataron como evidencia guardada, sin afirmar que el libro haya sido recalculado en Excel.

| Fuente | Observación comprobada |
| --- | --- |
| Libro principal | 20 hojas; Comparativa B1 = 30 09 2025; objetivo I2 = 550 |
| CLIENTES | 76 filas tras cabecera; 46 nombres BC distintos no vacíos; complejidad Basic Medium Enterprise |
| PERSONAL y PERSONAL PMO | 75 y 17 filas; PMO con 11 ANA y 6 DEV |
| Zendesk Time | 247140 filas; 183 duplicadas exactas en los 11 campos; 58372 sin id |
| Zendesk Time y tickets | 1737 ticket_id distintos de tiempos no aparecen en el export de tickets |
| Identificador de tiempo | 188768 filas con id; 188767 ids distintos; uno aparece con una fila diferente |
| Zendesk tickets con tags | 113856 tickets únicos; 73 organizaciones; arrays JSON válidos en el fichero inspeccionado |
| Organizaciones y maestro | 12 organizaciones de tickets ausentes del maestro antiguo, que afectan a 4032 tickets |
| Wrike CSV | 3546 registros y siempre seis columnas al leer CSV correctamente; 5428,16666666783 horas brutas |
| Wrike sin imputación | 73 filas con persona y fecha vacías y cero horas |
| Wrike y tickets | 496 filas sin ticket explícito; 98 nombres con varios candidatos de 5 a 9 dígitos |
| PAP | 5629 filas; sin duplicados exactos; categorías múltiples con ;# |
| Finanzas | Tres fuentes con Grupo cliente, Vta Potencial, Diferencia, totales y filtros; sin mes ni año numérico |
| Tags de bugs | 36 tickets con bug; 21 además con algún tag N4 |
| Tags de escalado | Unión N3 = 2614; N2 y N3 = 2551; unión N4 = 421; conteos globales sin periodo mensual |

La suma bruta de horas no es todavía dedicación de soporte: incluye históricos, equipos y servicios que luego se filtran. Las cantidades y conteos son resultados de esta inspección, no cifras reconciliadas de un cierre publicado.

## Fórmulas y diferencias que hay que decidir

| Evidencia en origen | Implicación |
| --- | --- |
| Comparativa F6 = E6 / D6 × 8 | Rentabilidad comercial medida en euros por jornada |
| Comparativa G6 = (550 - F6) / 550 | Desviación positiva indica resultado bajo objetivo |
| Comparativa F43 = E43 / D43 × 8 con SUBTOTAL | La media filtrada es un ratio ponderado |
| DATA FACTURACIÓN E2 = B2 / 12 | El mes se imputa a partir de un importe anual |
| Análisis Cliente AN105 usa DAY(fecha)/31 | El prorrateo parcial no usa días reales del mes |
| DATA ZENDESK TIME P2 = G2 / 60 + F2 | Minutos y horas se combinan, hour no es duración |
| DATA ZENDESK TICKET F2 comprueba causa D | La regla actual usa causa raíz, no solo entorno |
| DATA WRIKE J2 extrae primeros dígitos antes de F2 | Puede preferir un número del título al ticket explícito |
| DATA WRIKE N y R fuerzan DEV a incidente/customización | Es una imputación heurística que no prueba causa |
| PulseRent W5 y BQ5 anualizan con usuarios a cierre | Con usuarios variables se necesita exposición mensual |
| PulseRent AN5 cuenta cualquier correctivo | Se solapa con estándar y origen cliente |
| PulseRent BR5 suma AM a AP | Puede contar varias veces un mismo PAP |
| PulseRent filas 45 a 68 y sus condicionales | P10 P25 P75 P90, cinco bandas y sentido invertido para ingreso |

Se han observado errores guardados en algunas columnas calculadas de las hojas de carga. Deben quedar visibles en la conciliación como incidencias de origen; no se considera correcto convertirlos en cero. La aplicación no depende de esos valores calculados para reconstruir hechos.

## Periodos de los exports

Zendesk Time cubre registros observados entre 6 de julio de 2021 y 28 de octubre de 2026. Wrike entre 2 de enero de 2025 y 28 de octubre de 2026, excluyendo las tareas sin fecha. PAP entre 14 de noviembre de 2022 y 29 de octubre de 2026. Las fechas extremas no certifican que el intervalo esté completo. Los tickets actuales carecen de created_at, por lo que no se puede reconstruir una cohorte mensual a partir de ese export solo.

## Evidencia visual

La captura 3 y 4 muestran la tarea Wrike 216527 partida al abrir Excel. El CSV íntegro conserva la coma y punto y coma dentro del nombre. La captura 5 coincide con las familias de soporte incluidas en el pie del export Power BI. De la pizarra se ha incorporado solo el bloque izquierdo de puntos 0 a 5 solicitado. El manual aporta #1f18c0, #000000, #dbba12 y Gilroy con alternativa Calibri para Office.

## Interpretación después de las aclaraciones

Las cifras anteriores describen los ficheros inspeccionados inicialmente, no errores de cliente ni una bandeja de tareas requerida. Las organizaciones ausentes pueden ser clientes nuevos de 2025/2026. Dennis confirma causas PAP múltiples, ingresos Vta Potencial, sustitución anual de las tres categorías y nuevo criterio de bug; esos acuerdos se recogen en DEC 001 y prevalecen sobre las propuestas iniciales.
