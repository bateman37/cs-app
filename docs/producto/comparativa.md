# Comparativa económica

## Periodo y columnas

ECO 01. El usuario selecciona fecha de análisis y ve la cobertura real de cada fuente. La fecha del equipo no sustituye la fecha de análisis. Abrir por defecto el mes en curso a fecha de corte, marcado como provisional, y permitir consultar un mes completo o cerrado. El libro adjunto está fechado el 30 de septiembre de 2025; los exports contienen registros de 2026 y no sirven para una conciliación directa de ese cierre sin filtrar y reconstruir el mismo ámbito.

| Bloque | Campos |
| --- | --- |
| Identificación | Cliente (nombre del Grupo BC), soporte y servidor (HOTFIX-02: sin producto, complejidad ni estado en la tabla) |
| Mes seleccionado | Horas, ingreso imputado, euros por jornada, desviación sobre 550 y sobre cartera filtrada |
| Mes anterior | Horas, ingreso imputado y euros por jornada |
| Año actual acumulado | Horas CUM, ingreso CUM, usuarios al corte, tarifa anual por usuario, euros por jornada CUM y ambas desviaciones |
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

## Implementación (CSAPP-06, rediseñada por HOTFIX-02)

Ruta `/comparativa`, lectura ADMIN y Consulta. Detalle técnico en [analítica CSAPP-06](../arquitectura/analitica-csapp06.md); fórmulas en el [catálogo](../calculos/catalogo.md) (CAL 31-36). Validación de este rediseño: [hotfix-02-comparativa](../validacion/hotfix-02-comparativa.md).

| Aspecto | Comportamiento |
| --- | --- |
| Ancho | El `main` padre de Comparativa, Análisis Cliente y Calidad no tiene límite de ancho (clase `main-wide` por ruta en `MainShell`); márgenes 20 px (16 px en móvil). Login, formularios de Administración y Pulse Rent conservan su ancho |
| Encabezado | Una línea: «Comparativa», mes, objetivo vigente (inicial 550 €/jornada) y rentabilidad agregada de mes y CUM (ΣR/ΣH×jornada del filtrado; `*` si el conjunto excluye Grupos con datos pendientes). Sin introducciones, sello, método, revisión ni cobertura |
| Filtros | **Solo dos**: Soporte (Gold, Platinum, Silver Recurrente, Silver On Demand) y Servidor (CLOUD, OP), segmentadores como enlaces, clic selecciona/deselecciona sin Ctrl. Sin selección = todos; OR dentro de un filtro y AND entre ambos **en el mismo Cliente** (un Cliente con Gold/OP y otro con Silver/CLOUD no satisface Gold+CLOUD). El Grupo incluido conserva todo su ingreso y sus horas. Valor mixto corto «Mixto», con detalle al puntero/foco |
| Periodo | Barra pequeña: mes y año, «A fecha de hoy / Mes completo», «Último mes cerrado» y etiqueta «Provisional». No es un filtro de negocio |
| Tabla | Una línea por Grupo BC (26-30 px, 12 px, números tabulares): Identificación (Cliente, Soporte, Servidor); Mes seleccionado (Horas, Facturación imputada, €/jornada, Desv. objetivo, Desv. media filtrada); Mes anterior (Horas, Facturación, €/jornada); Año actual CUM (Horas, Facturación, Usuarios al corte, Tarifa anual/usuario, €/jornada, ambas desviaciones); Año anterior completo y CUM anterior comparable (Horas, Facturación, €/jornada). Todos los bloques visibles. Cabeceras agrupadas de 2-3 líneas con unidades, fijas, primera columna fija, orden por cabecera (nulos siempre al final), anchos fijos que caben a 1920 px |
| Totales | Pie fijo con TODO el filtrado (no la página): horas e ingresos suman; €/jornada = ΣR/ΣH×jornada; desviación objetivo = (objetivo−ratio)/objetivo sobre ese ratio; usuarios = Σ stocks informados; tarifa = 12×ΣR/Σ usuarios·mes de los Grupos con tarifa. Un total parcial se marca `*` y se explica. «Desv. media filtrada» no aplica al total (es su propia referencia). Positivo = peor rendimiento, en rojo; negativo en verde (no confundir con la variación interanual) |
| Paginación | Tamaño fijo 50 sin selector; totales siempre del filtrado completo |
| Ausentes | «—» con la razón breve al clic/foco (`details`); nunca ceros inventados. Un único indicador discreto «Datos pendientes» (solo Admin lo abre) hacia Administración › Conciliación › Diagnóstico de datos |
| Error | Mensaje comprensible y «Reintentar»; el detalle técnico solo para Admin. No se oculta tras un cero |
| URL | Solo `fecha`, `modo`, `soporte`, `servidor`, `orden`, `dir`, `pagina`. Cualquier otra clave (`q`, `servicio`, `complejidad`, `producto`, `estado`, `cobertura`, `revision`, `tam`, `bloques`, `ref`, `alojamiento`…) se ignora al leer y no se escribe en ningún enlace |
| Ficha | El nombre del Grupo abre Análisis Cliente con `fecha`, `modo`, `soporte`, `servidor` y `volver` |
| CSV | `/api/analitica/comparativa.csv`: mismo periodo, selección y orden que la pantalla; todas las filas del filtrado y las filas de cartera con los mismos totales (incluidos usuarios y tarifa); columnas `soporte`/`servidor` (valor «Mixto: …» cuando difieren) y la selección en el ámbito |
| Información técnica | Sello, método, revisión de configuración, objetivo/jornada, cobertura financiera, reproceso pendiente y causas de cifras incompletas viven en Administración › Conciliación › «Diagnóstico de datos» (`#diagnostico`) y en el detalle «Ver cálculo» de la ficha |

Pendientes que NO se aceptan aquí: ZDT 11-13, ZTM 06-08, lista de origen PAP, estados de bugs, convención de «Diferencia» y propuestas de Silver (ver [pendientes](../decisiones/pendientes.md)). IDs ECO 01-08 sin cambios.
