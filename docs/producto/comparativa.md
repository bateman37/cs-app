# Comparativa económica

## Periodo y columnas

ECO 01. El usuario selecciona fecha de análisis y ve la cobertura real de cada fuente. La fecha del equipo no sustituye la fecha de análisis. Abrir por defecto el mes en curso a fecha de corte, marcado como provisional, y permitir consultar un mes completo o cerrado. El libro adjunto está fechado el 30 de septiembre de 2025; los exports contienen registros de 2026 y no sirven para una conciliación directa de ese cierre sin filtrar y reconstruir el mismo ámbito.

| Bloque | Campos |
| --- | --- |
| Identificación | Cliente, soporte, servidor, producto, complejidad y usuarios a cierre |
| Mes seleccionado | Horas, ingreso imputado, euros por jornada, desviación sobre 550 y sobre cartera filtrada |
| Mes anterior | Horas, ingreso imputado y euros por jornada |
| Año actual acumulado | Horas CUM, ingreso CUM, usuarios medios y a cierre, euros por jornada CUM y ambas desviaciones |
| Año anterior completo | Horas, ingreso y euros por jornada de los doce meses |
| Año anterior comparable | Horas CUM, ingreso CUM y euros por jornada hasta el mismo corte del año anterior |

ECO 02. Enero compara mes anterior con diciembre del año anterior. Si el corte es diario, comparar con el día equivalente del año anterior, limitado al último día de ese mes. Si es cierre mensual, comparar enero a ese mes completo en ambos años. No usar la media de rentabilidades mensuales como rentabilidad acumulada.

## Ingresos y ámbito de servicio

ECO 03. SOPORTE, ADMIN_DELEGADA y OTROS son categorías explícitas. El indicador principal se calcula sobre soporte, excluyendo administración delegada y otros tanto en ingresos como en horas cuando se puedan clasificar. Ofrecer vistas separadas por servicio y una total solo si las dedicaciones están identificadas. La regla «todo lo que no es administración delegada es soporte» dejaría de ser válida al introducir OTROS.

ECO 04. El Excel divide el valor anual entre doce y prorratea el mes actual por DAY(fecha)/31. Regla confirmada: conservar la distribución anual lineal y utilizar los días reales del mes cuando haya corte parcial. No mostrar esos valores como facturas mensuales reales. Aprobada una fuente mensual real, podrá añadirse otro método de imputación sin sobrescribir el anterior. No inferir un calendario de cobro que el export no contiene.

## Fórmulas

ECO 05. Euros por jornada = ingreso del periodo / horas elegibles del periodo × 8. Horas objetivo = ingreso del periodo / 550 × 8. Desviación objetivo = (550 - euros por jornada) / 550. Un porcentaje positivo indica rendimiento por debajo del objetivo; uno negativo, por encima. Mantener este signo del Excel y explicarlo en la etiqueta.

ECO 06. La «media filtrada» del Excel es ingreso total visible / horas totales visibles × 8, es decir, un ratio ponderado por horas. No es el promedio aritmético de los ratios de clientes. Desviación cartera = (ratio cartera - ratio cliente) / ratio cartera. Los clientes sin denominador válido no producen un ratio; mostrar su ingreso y la incidencia de datos para que no desaparezcan del total sin explicación.

ECO 07. Con cero horas e ingreso positivo, mostrar «sin dedicación registrada», sin infinito ni una rentabilidad numérica inventada. Con cero ingresos y horas positivas, el ratio puede ser cero si la fuente de ingresos está completa. Si la fuente falta, el resultado es «datos incompletos». Los subtotales se calculan a partir de sus componentes.

## Filtros y Silver

ECO 08. Filtros aplicados afectan tabla, subtotales, media filtrada y exportación. Mostrar alcance, fecha y método de ingreso en el archivo descargado. El Excel deja vacíos los bloques mensuales para Silver. Propuesta: mantener esa presentación en el modo de equivalencia y permitirlos como opción separada cuando se decida la imputación de su ingreso no recurrente. No anualizar un Silver On Demand por defecto.

La columna «tarifa anual por usuario» es una aproximación económica calculada, no la tarifa contractual. Con usuarios variables se deben mostrar el denominador y el periodo, según el catálogo de cálculos.
