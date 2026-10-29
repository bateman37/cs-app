# Carga anual de ingresos

## Campos y significado confirmado

Los tres exports contienen Grupo cliente, Vta Potencial y Diferencia, además de totales y filtros. Dennis confirma que Vta Potencial es facturación realizada más cartera que caerá casi con seguridad. Es el importe anual de ingresos del modelo. Diferencia compara con el Budget de ese año; se guarda y muestra separadamente, sin sumarla al ingreso ni deducir un Budget absoluto mientras no se defina la convención de signo.

| Categoría | Filtros de referencia |
| --- | --- |
| SOPORTE | Plan Gold, Platinum, Silver On Demand, Silver Recurrente y Fee Silver Recurrente |
| ADMIN_DELEGADA | Administración Delegada |
| OTROS | Gestión Activos u Otros |

FAC 01. Seleccionar categoría y año explícitos. El pie Año Actual no informa el año numérico. Verificar cabeceras y filtros; Total y Filtros aplicados no se importan como clientes. Comparar la suma de líneas con el total de la columna Vta Potencial.

## Sustitución del conjunto completo

FAC 02. Las tres categorías se reciben como acumulados completos. Cada carga reemplaza todas las líneas de su año y categoría. No es una suma incremental. Soporte 2026 solo sustituye SOPORTE 2026; no borra ADMIN_DELEGADA 2026, OTROS 2026 ni otros años. La regla se aplica también al volver a cargar el mismo archivo.

FAC 03. Validar y preparar el archivo antes de sustituir. Activar el nuevo conjunto de forma atómica: un fallo mantiene el anterior. Guardar el lote anterior para recuperación/auditoría no significa sumarlo. Las filas ausentes del nuevo fichero dejan de estar activas en ese ámbito.

FAC 04. Una organización BC no registrada se muestra en el resumen. Antes de activar una sustitución anual con importes no asignables, informar qué se excluye y exigir resolver el maestro o confirmar expresamente ese alcance incompleto. No borrar el año anterior silenciosamente por un archivo vacío o equivocado. No crear una bandeja independiente de pendientes.

## Mes en curso y cierre

FAC 05. Ingreso mensual base = Vta Potencial anual / 12. En mes en curso: ingreso a fecha de corte = mensual base × día de corte / días reales del mes. Ejemplo: anual 12000, corte 15 de un mes de 30 días; mensual base 1000, ingreso imputado 500. A cierre de mes equivale al 100 por ciento del mensual base.

FAC 06. CUM es la suma de meses completos anteriores y el mes en curso prorrateado. La fecha de corte se muestra y se aplica tanto a horas como a ingresos. Comparar año anterior hasta el mismo corte, manteniendo por separado su año completo. No presentar como facturas mensuales reales la distribución lineal de un ingreso anual.

## Valores y datos iniciales

FAC 07. Guardar importes originales con precisión suficiente y redondear para mostrar. Una celda vacía de Vta Potencial no se interpreta con el valor de Diferencia. Se propone vacío monetario como cero solo cuando la exportación y sus totales lo confirmen; mostrar la advertencia en el resumen. Preservar ajustes negativos.

FAC 08. Plan, alojamiento y usuarios proceden del maestro con vigencia. Si BC agrupa varios proyectos, el ingreso sigue en el grupo y no se reparte artificialmente. Se pueden precargar históricos anteriores a 2025. Dennis importará 2025 y 2026 y comprobará mediante una segunda carga que se reemplazan correctamente.
