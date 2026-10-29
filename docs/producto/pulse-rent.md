# PulseRent

## Propósito y métricas

Conservar el análisis de dispersión entre clientes y permitir comparar una magnitud con un conjunto de referencia explícito. La lista inicial incluye las 23 métricas descritas por Dennis. Añadir las variantes IT N3 y Plataforma N4 que ya existen en el libro, y mantener visibles sus unidades. El catálogo de cálculos define los numeradores y denominadores.

| Familia | Indicadores |
| --- | --- |
| Dedicación por usuario | Totales, incidentes Vincle y otro soporte de CS N1, CS N2 y PMO N3; variantes IT y Plataforma |
| Ingresos por usuario | Ingreso anual de soporte por usuario y aproximación anualizada del periodo |
| PAP | Evolutivos no facturables, correctivos de proyecto, correctivos estándar y origen cliente; bruto y por usuario |
| Escalados | N3 por usuario, porcentaje N3 sobre tickets y porcentaje N2 a N3 con denominador específico |
| Economía | Horas CUM, usuarios a cierre, euros por jornada actual y anterior y desviaciones |
| Síntesis | Horas por usuario del periodo, equivalencia anual y PAP únicos por usuario |

No dividir todos los campos de nuevo: un ratio en euros por jornada o un porcentaje ya tiene denominador. Ofrecer la variante normalizada de los conteos PAP sin confundirla con los valores brutos del Excel.

## Referencias y estadística

PUL 01. Calcular media, mediana y percentiles continuos P10, P25, P75 y P90. El Excel usa PERCENTILE.INC con FILTER. El cálculo se hace por indicador sobre los valores válidos de clientes, con un cliente como una observación. La mediana de ratios y el ratio agregado de cartera son métricas distintas y ambas pueden mostrarse con su nombre.

PUL 02. Referencias iniciales equivalentes al Excel: sin Silver; Gold OP; Gold CLOUD; Platinum OP; Platinum CLOUD. Permitir todo el conjunto y filtros adicionales por producto o complejidad. Mostrar el número de clientes de referencia y sus criterios. Separar filtro de visualización y selección de referencia: ocultar un cliente no debe cambiar silenciosamente su semáforo de calidad.

## Cinco bandas del Excel

PUL 03. Para magnitudes en las que un valor alto indica mayor carga, los condicionales comprobados son:

| Intervalo | Banda |
| --- | --- |
| x <= P10 | Verde intenso |
| P10 < x <= P25 | Verde claro |
| P25 < x <= P75 | Amarillo |
| P75 < x <= P90 | Naranja |
| x > P90 | Rojo |

Para tarifa por usuario y euros por jornada se invierte el sentido: x < P10 rojo; P10 <= x < P25 naranja; P25 <= x < P75 amarillo; P75 <= x < P90 verde claro; x >= P90 verde intenso. Respetar las igualdades en los límites. Cuando varios percentiles coinciden, evaluar las reglas en ese orden sin inventar bandas de anchura artificial.

PUL 04. Las cinco bandas descriptivas de PulseRent no se copian directamente al semáforo de tres colores de Calidad. Cada métrica tiene dirección configurada. La rentabilidad económica no se incorpora como séptimo KPI de calidad.

## Usuarios y anualización

PUL 05. El libro anualiza horas como H / usuarios actuales / número de mes × 12. Eso equivale a suponer usuarios constantes y cobertura completa. La aplicación ofrece una vista de equivalencia histórica y una normalización mensual correcta cuando cambian usuarios. Para meses completos, horas equivalentes anuales por usuario = 12 × horas CUM / suma de usuarios mensuales del periodo.

El total de PAP no suma categorías que pueden solaparse. Conservar las banderas originales para explorar, pero contar cada PAP una vez en el total único. Cualquier causa correctiva convierte al PAP en correctivo, regla confirmada por Dennis. Conservar esas pertenencias múltiples y contar una vez el total; en Calidad los de origen cliente también se conservan y se explican por su familia. No forzar categorías exclusivas.

## Controles

Usuario cero o desconocido produce una celda sin ratio, con explicación. Una referencia pequeña muestra su tamaño y una advertencia descriptiva; la regla mínima para publicar semáforos pertenece al módulo Calidad. Guardar selección de KPI, orden y referencia en la URL o preferencias, no como estado oculto que altere el cálculo.
