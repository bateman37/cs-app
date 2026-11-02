# PulseRent

> **Implementado en CSAPP-07** (`/pulse-rent`, ver [arquitectura](../arquitectura/pulse-configuracion-csapp07.md) y [validación](../validacion/csapp-07.md)). El contrato PUL 01-05 sigue vigente; las secciones «Catálogo con IDs estables» y siguientes concretan cómo se aplica. Sin Windows, sin aceptación de Dennis y sin archivos reales.

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

## Catálogo con IDs estables (CSAPP-07)

Cada métrica tiene ID estable, etiqueta, familia, fuente, ámbito admitido, periodo, unidad bruta, numerador, denominador, variantes de normalización, dirección y estado. No hay fórmulas introducidas por el administrador ni sumas basadas en etiquetas de pantalla.

| IDs | Métrica | Notas |
| --- | --- | --- |
| M01-M03 / M04-M06 / M07-M09 | Horas de CS N1 / CS N2 / PMO N3: total, incidente Vincle confirmado, otro soporte clasificado | Partición: incidente + otro soporte + sin clasificar = total |
| M10 | Ingreso anual de soporte por usuario | `12 × R / UM`; variante «por usuario y mes» identificada; solo Grupo Cliente |
| M11 | PAP evolutivos no facturables | **No disponible** sin evidencia positiva de facturación; no se añade un campo manual |
| M12 / M13 / M14 | PAP correctivos de proyecto / estándar / origen cliente | Pertenencias que pueden solaparse; el total único no las suma |
| M15 | Porcentaje de tickets N2 que pasan a N3 | Tickets únicos con N2 y N3 / tickets únicos con N2 (denominador cero: no calculable) |
| M16 / M17 | Horas del periodo (CUM por defecto) / usuarios contratados al corte | Contexto, sin juicio favorable/desfavorable |
| M18 / M19 / M20 | €/jornada del periodo; desviación contra objetivo; desviación contra cartera de referencia | Positivo = por debajo |
| M21 | €/jornada del año anterior completo | Periodo explícito, distinto del CUM comparable |
| M22 / M23 | Horas totales por usuario; PAP únicos por usuario | |
| M24-M26 / M27-M29 | IT N3 y Plataforma N4: total, incidente, otro soporte | |
| M30 / M31 | Tickets escalados a N3 (PMO o IT, unión de ticket) por exposición; porcentaje de tickets que llegan a N3 sobre todos | M31 no sustituye el denominador N2 de M15 |
| M32-M36 | Horas **sin clasificar / pendientes** de cada perfil | Variante auxiliar visible |
| M37 / M38 | PAP evolutivos observados (sin evidencia de facturación) / PAP correctivos únicos | |

Los perfiles se resuelven por **selección canónica** (equipo y nivel del catálogo de personal, o pertenencia a PMO) configurada en Administración; nunca por texto de etiquetas. Un perfil sin selección muestra «Perfil sin configurar», no cero. El PMO de rol desconocido permanece en el total PMO elegible.

## Normalización y periodos

UM = usuarios mes: cada mes pesa días incluidos / días reales; un mes sin informar deja la exposición incompleta (no se rellena con cero ni se omite). En un corte parcial se pondera la **exposición** y el ingreso, nunca las horas o eventos ya registrados.

| Modo (aplica a toda la columna y a su referencia) | Horas | Eventos |
| --- | --- | --- |
| Equivalente anual (inicial) | `12 × H / UM` por usuario | `1200 × E / UM` por 100 usuarios |
| Del periodo | `H / UM` por usuario y mes | `100 × E / UM` por 100 usuarios y mes |
| Bruto | horas del periodo | eventos únicos del periodo |

Porcentajes, €/jornada y desviaciones ya son ratios y no se dividen de nuevo. El stock de usuarios es el valor del mes del corte. La **equivalencia histórica de horas** (`H_CUM / U_corte / nº de mes × 12`) es un modo separado, solo con CUM y mes completo; no sustituye a la normalización correcta. Los equivalentes anuales no son predicciones de eventos ni tarifas contractuales. Periodos: mes seleccionado, mes anterior, CUM actual, año anterior completo y CUM anterior comparable (contrato de CSAPP-06); un mes en curso se muestra provisional.

## Cohortes y estadística

Se separan **filas visibles** (búsqueda y filtros de presentación), **referencia estadística** (población de cada distribución) y **referencia económica** (cartera ΣR/ΣH×jornada). Ocultar, buscar, ordenar o paginar no cambian la referencia; «usar los filtros visibles como referencia» es una acción explícita que copia criterios a la URL y se rotula personalizada. La propia entidad entra una vez si cumple los criterios (sin leave-one-out). Referencias confirmadas: todo el conjunto, **sin Silver** (plan conocido distinto de Silver), Gold OP, Gold CLOUD, Platinum OP y Platinum CLOUD; las homogéneas excluyen mezclas, desconocidos y cobertura insuficiente, con motivo. La media aritmética de ratios y la cartera se muestran por separado.

Por columna, sobre toda la referencia válida antes de paginar: N, excluidas y motivos (cero confirmado participa, ausente no, parcial no), media, mediana, P10/P25/P75/P90 con percentil inclusivo continuo (posición `(N−1)×q`, interpolación lineal, decimales exactos). Sin N mínimo arbitrario para las bandas; N=1 o valores iguales muestran cortes coincidentes con advertencia.

## Estados de celda

Calculado · cero confirmado · dato ausente · no aplicable · parcial · perfil sin configurar. Un cero solo se publica con la fuente relevante presente en el periodo; las variantes que dependen de la causa de un ticket son cota inferior (parcial) si hay horas sin clasificar; un valor parcial no se colorea ni entra en la referencia. Cada celda abre una explicación (valor bruto, fórmula, numerador, denominador, ámbito, corte, origen, revisiones, referencia, cortes y regla de banda) y, desde el numerador, un detalle paginado con el mismo predicado.

## Configuración y límites

Referencias, dirección por métrica y perfiles viven en Administración › Configuración › Pulse Rent con revisión inmutable, borrador, activación y vuelta atrás ([administración](administracion.md)). Una nueva revisión invalida las bandas anteriores (el sello de datos incluye el manifiesto de revisiones). No existe un índice global Pulse ni se convierten las cinco bandas en los tres colores de Calidad. Pendientes sin aceptar: ZDT 11-13, ZTM 06-08, lista de origen PAP, estados de bugs, signo de «Diferencia» y Silver (ECO 08).
