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

## Implementación en CSAPP-05 (FAC 09-14)

Estado: **implementado y probado en Linux con XLSX sintéticos** ([validación](../validacion/csapp-05.md)); Windows y los archivos reales de Dennis, sin probar. Decisiones técnicas en [finanzas y motor económico](../arquitectura/finanzas-motor-csapp05.md).

FAC 09. **Tres perfiles** (`facturacion-soporte`, `facturacion-admin-delegada`, `facturacion-otros`), todos de sustitución. La categoría es fija del perfil; el **año** se elige en el formulario y se valida en servidor, junto con la declaración de «conjunto anual completo»; no se confía en campos ocultos. No se aplica a finanzas la limitación de edición de usuarios al año actual (se aceptan años 2000 a año actual + 1). Las cabeceras `Grupo cliente`, `Vta Potencial` y `Diferencia` se validan **por contenido** (orden libre, espacios exteriores y mayúsculas controlados; ausentes o duplicadas se rechazan; columnas adicionales se conservan con aviso; con varias hojas compatibles se exige la hoja). Nunca se ejecutan fórmulas, macros, consultas IQY, enlaces ni HTML: una celda de fórmula sin valor almacenado es un error, no un cero. El pie «Filtros aplicados» se contrasta con la categoría (DESC_L4 de la tabla anterior); «Año Actual es Año Actual» **no** informa el año numérico; un año explícito incompatible o filtros de otra categoría **bloquean**; sin pie o con un pie no verificable se muestra qué no se pudo comprobar y se exige la declaración expresa de categoría, filtros y cobertura completa. Total, pie y filas vacías son controles (no clientes); una línea desconocida, un subtotal intermedio o totales incompatibles no se ignoran. Las filas de las muestras (40, 4 y 7) son tamaños de ejemplo, no límites.

FAC 10. **Importes y vacíos.** Decimal exacto desde el texto de origen (`NUMERIC(38,20)`), con notación científica, negativos y residuos de coma flotante; se redondea solo para mostrar. Una `Vta Potencial` vacía **no** toma el valor de `Diferencia`; sin decisión se conserva desconocida y bloquea la sustitución incompleta. Cada lote puede decidir expresamente tratar los vacíos como cero (muestra filas afectadas; exige Total presente y conciliación; no vale para texto inválido ni fórmulas sin valor; guarda vacío original, cero derivado, actor y motivo): **no es una regla aprobada global** (FAC 07 sigue propuesto). `Diferencia` vacía permanece desconocida.

FAC 11. **Duplicados y conciliación.** Filas idénticas (misma clave normalizada e importes canónicos) cuentan una vez; el mismo grupo con importes contradictorios bloquea (todas sus filas son error). Se concilia la suma de filas únicas contra el Total de `Vta Potencial` con una **tolerancia absoluta** de 0,01 € (propuesta técnica, revisión de configuración, capturada al preparar); se muestran suma bruta, duplicados, suma única, atribuido y sin asignar, y el control de `Diferencia` si existe. El Total no se importa como ingreso ni ajusta los detalles. Sin Total se exige registrar su revisión.

FAC 12. **Resolución BC y sin asignar.** Por equivalencias BC/GROUP_KEY cuya vigencia intersecta el **año** (no enero, diciembre ni la fecha de subida). Un grupo → resuelto con sus intervalos; grupos distintos → asignación anual explícita y auditada o corregir la fuente; ninguno → sin asignar. Activar con importes sin asignar exige la aceptación expresa del FAC 04 (qué queda fuera y cuánto); no se tiran filas ni se crea una bandeja aparte. Varias denominaciones en el mismo grupo canónico exigen revisar la colisión.

FAC 13. **Sustitución, revisión y recuperación.** La ficha muestra año/categoría, filtros, conciliación, lote activo que se reemplaza, total anterior/nuevo, variación, grupos nuevos/modificados/retirados/sin cambios y sin asignar (filas fuente y grupos canónicos por separado; «retirado» no es baja del maestro). Preparar y revisar no cambian hechos activos; activar sustituye **todo** el ámbito en una transacción; repetir el mismo archivo conserva sus ingresos; un fichero vacío o solo Total/pie no es una orden de borrado. La revisión guarda el lote y la versión del conjunto vigente vistos: si otra carga lo sustituye antes de activar, la confirmación antigua no se aplica y hay que actualizar el impacto. Una extracción declarada anterior a la del conjunto activo exige reconocer el retroceso. Revertir solo el lote vigente restaura su predecesor completo (o ausencia de fuente); un supersedido no se revierte ni se reactiva; Reprocesar un completado recalcula atribución sin tocar dinero, año, filtros ni extracción.

FAC 14. **Históricos anteriores a 2025.** Vía asistida e idempotente desde la hoja `DATA FACTURACIÓN` (`Grupo cliente`, `Facturación anual`, `Año`, `Soporte`, `Facturación mes`, `Admin Delegada`, `Servidor`, `Usuarios`): usa grupo, importe anual, año y categoría explícita; las columnas mensuales/formuladas no son otros ingresos; no inventa OTROS, Diferencia, usuarios ni modalidad de soporte. Simulación por defecto, rechazo de 2025 en adelante, ámbitos ya activos protegidos, procedencia visible; nunca en migración, arranque ni instalación. Una sustitución posterior usa la revisión financiera normal. Estado: adaptador probado con datos sintéticos; **precarga no realizada: falta fuente**.
